// DeepSeek AI Provider
// OpenAI-compatible API format at https://api.deepseek.com
// Supports stream + response_format: { type: "json_object" } simultaneously

const BASE_URL = 'https://api.deepseek.com';

async function chatCompletions(apiKey, model, messages, options) {
  const key = apiKey || process.env.DEEPSEEK_API_KEY || '';
  const body = {
    model: model || 'deepseek-v4-flash',
    messages,
    temperature: options.temperature || 0.7,
    max_tokens: options.max_tokens || 4096
  };

  if (options.response_format) {
    // DeepSeek supports json_object but not json_schema
    if (options.response_format.type === 'json_schema') {
      body.response_format = { type: 'json_object' };
    } else {
      body.response_format = options.response_format;
    }
  }

  const contentLen = (messages[1] && messages[1].content && typeof messages[1].content === 'string')
    ? messages[1].content.length : 0;
  console.log('[deepseek] posting to', BASE_URL + '/chat/completions',
    'model=' + body.model, 'contentLen=' + contentLen,
    'max_tokens=' + body.max_tokens);

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
    console.log('[deepseek] response status=' + res.status + ' time=' + ms + 'ms');
    const text = await res.text();
    if (!res.ok) {
      console.log('[deepseek] error body=' + text.substring(0, 500));
      throw new Error(res.status + ' ' + res.statusText + ': ' + text.substring(0, 200));
    }
    return JSON.parse(text);
  } catch (e) {
    clearTimeout(timeout);
    const ms = Date.now() - start;
    if (e.name === 'AbortError') {
      console.log('[deepseek] TIMEOUT after ' + ms + 'ms');
      throw new Error('AI响应超时（超过5分钟），可能是内容过长或网络慢。请减少资料后重试。');
    }
    console.log('[deepseek] fetch error after ' + ms + 'ms - ' + e.message);
    throw e;
  }
}

async function streamChatCompletions(apiKey, model, messages, options, onEvent, signal) {
  const key = apiKey || process.env.DEEPSEEK_API_KEY || '';
  const body = {
    model: model || 'deepseek-v4-flash',
    messages,
    stream: true,
    temperature: options.temperature || 0.7,
    max_tokens: options.max_tokens || 4096
  };

  // DeepSeek supports json_object with streaming
  if (options.response_format) {
    if (options.response_format.type === 'json_schema') {
      body.response_format = { type: 'json_object' };
    } else {
      body.response_format = options.response_format;
    }
  }

  const start = Date.now();
  console.log('[deepseek] streaming to', BASE_URL + '/chat/completions',
    'model=' + body.model, 'max_tokens=' + body.max_tokens);

  const res = await fetch(BASE_URL + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + key
    },
    body: JSON.stringify(body),
    signal
  });

  console.log('[deepseek] stream response status=' + res.status);
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
      } catch (e) { /* skip */ }
    }
  }

  const elapsed = Date.now() - start;
  console.log('[deepseek] stream done, totalMs=' + elapsed + ', contentLen=' + fullContent.length);
  return { content: fullContent, elapsed };
}

function supportsJsonSchema(_model) {
  // DeepSeek doesn't support native json_schema, only json_object
  return false;
}

function supportsStreamWithJsonSchema(_model) {
  // DeepSeek supports json_object with streaming
  return true;
}

module.exports = {
  name: 'deepseek',
  baseURL: BASE_URL,
  chatCompletions,
  streamChatCompletions,
  supportsJsonSchema,
  supportsStreamWithJsonSchema
};
