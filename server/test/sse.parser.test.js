'use strict';

const { forEachSseData } = require('../src/providers/sse');

function streamFromChunks(chunks) {
  const encoder = new TextEncoder();
  const encoded = chunks.map((chunk) => encoder.encode(chunk));
  let index = 0;

  return {
    body: {
      getReader() {
        return {
          read() {
            if (index < encoded.length) {
              const value = encoded[index++];
              return Promise.resolve({ done: false, value });
            }
            return Promise.resolve({ done: true, value: undefined });
          },
          releaseLock() {},
        };
      },
    },
  };
}

describe('SSE 缓冲解析器', () => {
  it('data 行被 TCP 分片拆开时仍能完整解析', async () => {
    const events = [];
    const response = streamFromChunks([
      'data: {"choices":[{"delta":{"content":"你"',
      '}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
    ]);

    await forEachSseData(response, (data) => events.push(data));

    expect(events).toEqual([
      '{"choices":[{"delta":{"content":"你"}}]}',
      '{"choices":[{"delta":{"content":"好"}}]}',
    ]);
  });

  it('支持 data: 和 data: 两种格式，并忽略 [DONE]', async () => {
    const events = [];
    const response = streamFromChunks([
      'data: {"a":1}\n\n',
      'data:{"b":2}\n\n',
      'data: [DONE]\n\n',
    ]);

    await forEachSseData(response, (data) => events.push(data));

    expect(events).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('单个 chunk 内包含多个 data 行', async () => {
    const events = [];
    const response = streamFromChunks([
      'data: {"n":1}\ndata: {"n":2}\ndata: {"n":3}\n\n',
    ]);

    await forEachSseData(response, (data) => events.push(data));

    expect(events).toEqual(['{"n":1}', '{"n":2}', '{"n":3}']);
  });

  it('流结束时处理没有换行的最后一行', async () => {
    const events = [];
    const response = streamFromChunks(['data: {"last":true}']);

    await forEachSseData(response, (data) => events.push(data));

    expect(events).toEqual(['{"last":true}']);
  });
});
