'use strict';

// OpenAI-compatible Provider 基座（v3.27）
// ECNU / DeepSeek / OpenAI 共用同一套鉴权、请求体构造、超时与 SSE 解析逻辑；
// 差异仅通过 config 注入：baseUrl、defaultModel、环境变量 Key、response_format 映射。

const { forEachSseData } = require('./sse');

const DEFAULT_TIMEOUT_MS = 300000;

function createOpenAICompatibleProvider(config) {
  const name = config.name;
  const baseUrl = config.baseUrl;
  const defaultModel = config.defaultModel;
  const envKey = config.envKey || (name + '_API_KEY').toUpperCase();
  const mapResponseFormat = config.mapResponseFormat || ((format) => format);
  const supportsJsonSchema = config.supportsJsonSchema || (() => false);
  const supportsStreamWithJsonSchema = config.supportsStreamWithJsonSchema || supportsJsonSchema;

  function resolveApiKey(apiKey) {
    return apiKey || process.env[envKey] || '';
  }

  function resolveBaseUrl(options) {
    return (options && options.baseUrl) || baseUrl;
  }

  function buildBody(apiKey, model, messages, options, stream) {
    const body = {
      model: model || defaultModel,
      messages,
      stream: !!stream,
      temperature: options && typeof options.temperature === 'number'
        ? options.temperature
        : 0.7,
      max_tokens: (options && options.max_tokens) || 4096,
    };

    if (options && options.response_format) {
      body.response_format = mapResponseFormat(options.response_format);
    }

    return body;
  }

  function logRequest(streaming, model, body, contentLength) {
    console.log(
      `[${name}] ${streaming ? 'streaming' : 'posting'} to ${baseUrl}/chat/completions, model=${body.model}, contentLen=${contentLength}, max_tokens=${body.max_tokens}`
    );
  }

  async function chatCompletions(apiKey, model, messages, options) {
    const key = resolveApiKey(apiKey);
    const endpoint = resolveBaseUrl(options) + '/chat/completions';
    const body = buildBody(apiKey, model, messages, options, false);

    const contentLength = messages && messages[1] && typeof messages[1].content === 'string'
      ? messages[1].content.length
      : 0;
    logRequest(false, model, body, contentLength);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    const abortFromCaller = () => controller.abort();
    if (options && options.signal) {
      if (options.signal.aborted) controller.abort();
      else options.signal.addEventListener('abort', abortFromCaller, { once: true });
    }
    const start = Date.now();

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + key,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const ms = Date.now() - start;
      const text = await res.text();
      console.log(`[${name}] response status=${res.status} time=${ms}ms`);

      if (!res.ok) {
        console.log(`[${name}] error body=${text.substring(0, 500)}`);
        throw new Error(res.status + ' ' + res.statusText + ': ' + text.substring(0, 200));
      }

      return JSON.parse(text);
    } catch (e) {
      clearTimeout(timeout);
      if (options && options.signal) options.signal.removeEventListener('abort', abortFromCaller);
      const ms = Date.now() - start;
      if (e.name === 'AbortError') {
        if (options && options.signal && options.signal.aborted) {
          console.log(`[${name}] aborted by caller after ${ms}ms`);
          throw new Error('已取消');
        }
        console.log(`[${name}] TIMEOUT after ${ms}ms`);
        throw new Error('AI响应超时（超过5分钟），可能是内容过长或网络慢。请减少资料后重试。');
      }
      console.log(`[${name}] fetch error after ${ms}ms - ${e.message}`);
      throw e;
    }
  }

  async function streamChatCompletions(apiKey, model, messages, options, onEvent, signal) {
    const key = resolveApiKey(apiKey);
    const endpoint = resolveBaseUrl(options) + '/chat/completions';
    const body = buildBody(apiKey, model, messages, options, true);

    const contentLength = messages && messages[1] && typeof messages[1].content === 'string'
      ? messages[1].content.length
      : 0;
    logRequest(true, model, body, contentLength);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    const abortFromCaller = () => controller.abort();

    if (signal) {
      if (signal.aborted) {
        controller.abort();
      } else {
        signal.addEventListener('abort', abortFromCaller, { once: true });
      }
    }

    const start = Date.now();

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + key,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      console.log(`[${name}] stream response status=${res.status}`);

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(res.status + ' ' + errText.substring(0, 200));
      }

      let fullContent = '';
      let deltaCount = 0;

      await forEachSseData(res, (data) => {
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch (_) {
          return; // 跳过无法解析的行，等待后续补全。
        }

        const delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta
          ? parsed.choices[0].delta.content
          : undefined;

        if (delta) {
          fullContent += delta;
          deltaCount++;
          if (onEvent) {
            onEvent({ type: 'delta', content: delta, full: fullContent, deltaCount });
          }
        }
      });

      const elapsed = Date.now() - start;
      console.log(`[${name}] stream done, totalMs=${elapsed}, contentLen=${fullContent.length}`);
      return { content: fullContent, elapsed };
    } catch (e) {
      const ms = Date.now() - start;
      if (e.name === 'AbortError') {
        console.log(`[${name}] stream aborted after ${ms}ms`);
        throw e;
      }
      console.log(`[${name}] stream error after ${ms}ms - ${e.message}`);
      throw e;
    } finally {
      clearTimeout(timeout);
      if (signal) signal.removeEventListener('abort', abortFromCaller);
    }
  }

  return {
    name,
    baseURL: baseUrl,
    chatCompletions,
    streamChatCompletions,
    supportsJsonSchema,
    supportsStreamWithJsonSchema,
  };
}

module.exports = { createOpenAICompatibleProvider };
