// Google Gemini AI Provider
// Different API format entirely — requires adapter layer for:
//   1. messages → contents[] (role mapping: user→user, assistant→model)
//   2. system → systemInstruction (not in contents array)
//   3. SSE format: candidates[0].content.parts[0].text vs choices[0].delta.content
//   4. API key via query param ?key= (not Authorization header)
//   5. No response_format support — format enforced via prompt

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

function convertMessages(messages) {
  var systemInstruction = null;
  var contents = [];

  for (var i = 0; i < messages.length; i++) {
    var msg = messages[i];
    if (msg.role === 'system') {
      systemInstruction = { parts: [{ text: msg.content }] };
    } else {
      var role = msg.role === 'assistant' ? 'model' : 'user';
      contents.push({
        role: role,
        parts: [{ text: msg.content }]
      });
    }
  }

  return { contents: contents, systemInstruction: systemInstruction };
}

async function chatCompletions(apiKey, model, messages, options) {
  var key = apiKey || process.env.GEMINI_API_KEY || '';
  var m = model || 'gemini-2.5-flash';

  var converted = convertMessages(messages);

  var body = {
    contents: converted.contents,
    generationConfig: {
      temperature: options.temperature || 0.7,
      maxOutputTokens: options.max_tokens || 4096,
      responseMimeType: 'application/json'
    }
  };

  if (converted.systemInstruction) {
    body.systemInstruction = converted.systemInstruction;
  }

  var contentLen = (messages[1] && messages[1].content && typeof messages[1].content === 'string')
    ? messages[1].content.length : 0;
  console.log('[gemini] posting to', BASE_URL + '/models/' + m + ':generateContent',
    'model=' + m, 'contentLen=' + contentLen);

  var controller = new AbortController();
  var timeout = setTimeout(function() { controller.abort(); }, 300000);
  var abortFromCaller = function() { controller.abort(); };
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener('abort', abortFromCaller, { once: true });
  }
  var start = Date.now();

  try {
    var res = await fetch(BASE_URL + '/models/' + m + ':generateContent?key=' + key, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Connection': 'close' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timeout);
    var ms = Date.now() - start;
    console.log('[gemini] response status=' + res.status + ' time=' + ms + 'ms');
    var text = await res.text();
    if (!res.ok) {
      console.log('[gemini] error body=' + text.substring(0, 500));
      throw new Error(res.status + ' ' + res.statusText + ': ' + text.substring(0, 200));
    }

    var parsed = JSON.parse(text);
    // Convert Gemini response to OpenAI-compatible format
    var content = '';
    if (parsed.candidates && parsed.candidates[0] && parsed.candidates[0].content) {
      var parts = parsed.candidates[0].content.parts;
      if (parts) {
        for (var i = 0; i < parts.length; i++) {
          if (parts[i].text) content += parts[i].text;
        }
      }
    }

    var usage = {};
    if (parsed.usageMetadata) {
      usage = {
        prompt_tokens: parsed.usageMetadata.promptTokenCount || 0,
        completion_tokens: parsed.usageMetadata.candidatesTokenCount || 0,
        total_tokens: parsed.usageMetadata.totalTokenCount || 0
      };
    }

    return {
      choices: [{ message: { content: content } }],
      usage: usage
    };
  } catch (e) {
    clearTimeout(timeout);
    if (options.signal) options.signal.removeEventListener('abort', abortFromCaller);
    var ms2 = Date.now() - start;
    if (e.name === 'AbortError') {
      if (options.signal && options.signal.aborted) {
        console.log('[gemini] aborted by caller after ' + ms2 + 'ms');
        throw new Error('已取消');
      }
      console.log('[gemini] TIMEOUT after ' + ms2 + 'ms');
      throw new Error('AI响应超时（超过5分钟），可能是内容过长或网络慢。请减少资料后重试。');
    }
    console.log('[gemini] fetch error after ' + ms2 + 'ms - ' + e.message);
    throw e;
  }
}

async function streamChatCompletions(apiKey, model, messages, options, onEvent, signal) {
  const { forEachSseData } = require('./sse');
  const key = apiKey || process.env.GEMINI_API_KEY || '';
  const m = model || 'gemini-2.5-flash';

  const converted = convertMessages(messages);

  const body = {
    contents: converted.contents,
    generationConfig: {
      temperature: options.temperature || 0.7,
      maxOutputTokens: options.max_tokens || 4096,
      responseMimeType: 'application/json'
    }
  };

  if (converted.systemInstruction) {
    body.systemInstruction = converted.systemInstruction;
  }

  // T7: 统一超时 + 外部取消 — 超时/取消均通过 AbortController 中止 fetch
  const controller = new AbortController();
  const timeoutMs = options.timeout_ms || 300000;
  const timeout = setTimeout(function () { controller.abort(); }, timeoutMs);
  const abortFromCaller = function () { controller.abort(); };
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', abortFromCaller, { once: true });
  }

  const start = Date.now();
  console.log('[gemini] streaming to', BASE_URL + '/models/' + m + ':streamGenerateContent',
    'model=' + m);

  try {
    const res = await fetch(BASE_URL + '/models/' + m + ':streamGenerateContent?alt=sse&key=' + key, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Connection': 'close' },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    console.log('[gemini] stream response status=' + res.status);
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(res.status + ' ' + errText.substring(0, 200));
    }

    let fullContent = '';
    let deltaCount = 0;

    // T7: 统一 SSE 解析（sse.js 跨 chunk 缓冲，兼容 "data:" 与 "data: " 两种格式）
    await forEachSseData(res, function (data) {
      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch (e) { return; }
      // Gemini format: candidates[0].content.parts[0].text
      const candidate = parsed.candidates && parsed.candidates[0];
      if (candidate && candidate.content && candidate.content.parts) {
        let text = '';
        for (let k = 0; k < candidate.content.parts.length; k++) {
          if (candidate.content.parts[k].text) text += candidate.content.parts[k].text;
        }
        if (text) {
          fullContent += text;
          deltaCount++;
          if (onEvent) {
            onEvent({ type: 'delta', content: text, full: fullContent, deltaCount });
          }
        }
      }
    });

    const elapsed = Date.now() - start;
    console.log('[gemini] stream done, totalMs=' + elapsed + ', contentLen=' + fullContent.length);
    return { content: fullContent, elapsed };
  } catch (e) {
    clearTimeout(timeout);
    if (signal) signal.removeEventListener('abort', abortFromCaller);
    const ms = Date.now() - start;
    if (e.name === 'AbortError') {
      if (signal && signal.aborted) {
        console.log('[gemini] stream aborted by caller after ' + ms + 'ms');
        throw new Error('已取消');
      }
      console.log('[gemini] stream TIMEOUT after ' + ms + 'ms');
      throw new Error('AI响应超时（超过5分钟），可能是内容过长或网络慢。请减少资料后重试。');
    }
    console.log('[gemini] stream error after ' + ms + 'ms - ' + e.message);
    throw e;
  }
}

function supportsJsonSchema(_model) {
  return false;
}

function supportsStreamWithJsonSchema(_model) {
  return false;
}

module.exports = {
  name: 'gemini',
  baseURL: BASE_URL,
  chatCompletions,
  streamChatCompletions,
  supportsJsonSchema,
  supportsStreamWithJsonSchema
};