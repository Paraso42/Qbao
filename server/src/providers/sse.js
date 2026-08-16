'use strict';

// 统一 SSE 解析：跨 chunk 缓冲，兼容 "data:" 与 "data: " 两种格式。
// 解决旧实现按 chunk.split('\n') 解析时，长 data 行被 TCP 分片截断的问题。

async function forEachSseData(response, onData) {
  if (!response || !response.body || typeof response.body.getReader !== 'function') {
    throw new Error('响应不是可读流');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  function processLine(line) {
    if (!line.startsWith('data:')) return;
    let data = line.slice(5);
    if (data.startsWith(' ')) data = data.slice(1);
    if (data === '[DONE]') return;
    if (data) onData(data);
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
        buffer = buffer.slice(newlineIndex + 1);
        processLine(line);
      }
    }

    // 流结束前可能还有最后一行没有换行符。
    if (buffer) processLine(buffer);
  } finally {
    try { reader.releaseLock(); } catch (_) {}
  }
}

module.exports = { forEachSseData };
