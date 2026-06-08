// ECNU (华东师范大学) AI Provider
// Extracted from ai.routes.js — wraps existing ECNU API logic in provider interface

const BASE_URL = 'https://chat.ecnu.edu.cn/open/api/v1';

function chatCompletions(apiKey, model, messages, options) {
  return callEcnuApi(apiKey, model, messages, options);
}

async function streamChatCompletions(apiKey, model, messages, options, onEvent, signal) {
  const streamBody = {
    model: model || 'ecnu-plus',
    messages,
    stream: true,
    temperature: options.temperature || 0.7,
    max_tokens: options.max_tokens || 4096
  };

  const start = Date.now();
  console.log('[ecnu] streaming to', BASE_URL + '/chat/completions', 'model=' + model);

  const res = await fetch(BASE_URL + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey
    },
    body: JSON.stringify(streamBody),
    signal
  });

  console.log('[ecnu] stream response status=' + res.status);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(res.status + ' ' + errText.substring(0, 200));
  }

  let fullContent = '';
  let deltaCount = 0;
  const decoder = new TextDecoder();
  const reader = res.body.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n');
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          fullContent += delta;
          deltaCount++;
          if (onEvent) {
            onEvent({ type: 'delta', content: delta, full: fullContent, deltaCount });
          }
        }
      } catch (e) { /* skip unparseable lines */ }
    }
  }

  const elapsed = Date.now() - start;
  console.log('[ecnu] stream done, totalMs=' + elapsed + ', contentLen=' + fullContent.length);
  return { content: fullContent, elapsed };
}

async function callEcnuApi(apiKey, model, messages, options) {
  const key = apiKey || process.env.ECNU_API_KEY || 'your-key';
  const body = { model, messages, ...options };

  const contentLen = (body.messages[1] && body.messages[1].content && typeof body.messages[1].content === 'string')
    ? body.messages[1].content.length : 0;
  console.log('[ecnu] posting to', BASE_URL + '/chat/completions',
    'model=' + model, 'contentLen=' + contentLen,
    'max_tokens=' + (options.max_tokens || 'default'));

  const controller = new AbortController();
  const timeout = setTimeout(function() { controller.abort(); }, 300000);
  const start = Date.now();

  try {
    const res = await fetch(BASE_URL + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timeout);
    const ms = Date.now() - start;
    console.log('[ecnu] response status=' + res.status + ' time=' + ms + 'ms');
    const text = await res.text();
    if (!res.ok) {
      console.log('[ecnu] error body=' + text.substring(0, 500));
      throw new Error(res.status + ' ' + res.statusText + ': ' + text.substring(0, 200));
    }
    return JSON.parse(text);
  } catch (e) {
    clearTimeout(timeout);
    const ms = Date.now() - start;
    if (e.name === 'AbortError') {
      console.log('[ecnu] TIMEOUT after ' + ms + 'ms');
      throw new Error('AI响应超时（超过5分钟），可能是内容过长或网络慢。请减少资料后重试。');
    }
    console.log('[ecnu] fetch error after ' + ms + 'ms - ' + e.message);
    throw e;
  }
}

// ECNU model capability helpers
function supportsJsonSchema(model) {
  return model === 'ecnu-plus' || model === 'ecnu-max' || model === 'ecnu-turbo';
}

function supportsStreamWithJsonSchema(model) {
  // Diagnostic verified: both ecnu-plus and ecnu-max support json_schema in streaming mode
  return model === 'ecnu-plus' || model === 'ecnu-max';
}

module.exports = {
  name: 'ecnu',
  baseURL: BASE_URL,
  chatCompletions,
  streamChatCompletions,
  supportsJsonSchema,
  supportsStreamWithJsonSchema
};
