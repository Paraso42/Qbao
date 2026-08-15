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
  var start = Date.now();

  try {
    var res = await fetch(BASE_URL + '/models/' + m + ':generateContent?key=' + key, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    var ms2 = Date.now() - start;
    if (e.name === 'AbortError') {
      console.log('[gemini] TIMEOUT after ' + ms2 + 'ms');
      throw new Error('AI响应超时（超过5分钟），可能是内容过长或网络慢。请减少资料后重试。');
    }
    console.log('[gemini] fetch error after ' + ms2 + 'ms - ' + e.message);
    throw e;
  }
}

async function streamChatCompletions(apiKey, model, messages, options, onEvent, signal) {
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

  var start = Date.now();
  console.log('[gemini] streaming to', BASE_URL + '/models/' + m + ':streamGenerateContent',
    'model=' + m);

  var res = await fetch(BASE_URL + '/models/' + m + ':streamGenerateContent?alt=sse&key=' + key, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal
  });

  console.log('[gemini] stream response status=' + res.status);
  if (!res.ok) {
    var errText = await res.text();
    throw new Error(res.status + ' ' + errText.substring(0, 200));
  }

  var fullContent = '';
  var deltaCount = 0;
  var decoder = new TextDecoder();
  var reader = res.body.getReader();

  while (true) {
    var r = await reader.read();
    if (r.done) break;
    var chunk = decoder.decode(r.value, { stream: true });
    var lines = chunk.split('\n');
    for (var j = 0; j < lines.length; j++) {
      var line = lines[j];
      if (!line.startsWith('data: ')) continue;
      var data = line.slice(6);
      if (data === '[DONE]') continue;
      try {
        var parsed = JSON.parse(data);
        // Gemini format: candidates[0].content.parts[0].text
        var candidate = parsed.candidates && parsed.candidates[0];
        if (candidate && candidate.content && candidate.content.parts) {
          var text = '';
          for (var k = 0; k < candidate.content.parts.length; k++) {
            if (candidate.content.parts[k].text) text += candidate.content.parts[k].text;
          }
          if (text) {
            fullContent += text;
            deltaCount++;
            if (onEvent) {
              onEvent({ type: 'delta', content: text, full: fullContent, deltaCount: deltaCount });
            }
          }
        }
      } catch (e) { /* skip */ }
    }
  }

  var elapsed = Date.now() - start;
  console.log('[gemini] stream done, totalMs=' + elapsed + ', contentLen=' + fullContent.length);
  return { content: fullContent, elapsed: elapsed };
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
