'use strict';

// T7: gemini 流式修复 — 统一 sse.js 解析（跨 chunk 缓冲）+ 超时/取消控制

const gemini = require('../src/providers/gemini');

// 把一个完整 SSE 文本按任意小粒度切成多个 chunk 的流（模拟 TCP 分片）
function sseResponse(sseText, pieceSize) {
  const encoder = new TextEncoder();
  const chunks = [];
  for (let i = 0; i < sseText.length; i += pieceSize) {
    chunks.push(encoder.encode(sseText.slice(i, i + pieceSize)));
  }
  return {
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(c);
        controller.close();
      },
    }),
  };
}

// 挂起流：不推任何数据，直到 signal abort 时报 AbortError（用于超时/取消测试）
function hangingResponse(signal) {
  return {
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        signal.addEventListener('abort', () => {
          controller.error(new DOMException('Aborted', 'AbortError'));
        });
      },
      pull() { /* 保持挂起 */ },
    }),
  };
}

describe('gemini provider 流式修复 (T7)', () => {
  const origFetch = global.fetch;
  afterEach(() => {
    global.fetch = origFetch;
  });

  it('SSE 长行被 TCP 分片截断时仍能完整解析（forEachSseData 跨 chunk 缓冲）', async () => {
    const evt1 = JSON.stringify({
      candidates: [{ content: { parts: [{ text: '第一段' }, { text: '第二段' }] } }],
    });
    const evt2 = JSON.stringify({
      candidates: [{ content: { parts: [{ text: '第三段' }] } }],
    });
    const sseText = 'data: ' + evt1 + '\n\ndata:' + evt2 + '\n\ndata: [DONE]\n\n';

    global.fetch = async () => sseResponse(sseText, 5); // 每 5 字节一个 chunk，必然切进 JSON 内部

    const events = [];
    const result = await gemini.streamChatCompletions(
      'test-key', 'gemini-2.5-flash',
      [{ role: 'user', content: 'hi' }],
      { temperature: 0.7, max_tokens: 4096 },
      (evt) => events.push(evt)
    );

    expect(result.content).toBe('第一段第二段第三段');
    expect(result.elapsed).toBeGreaterThanOrEqual(0);
    expect(events).toHaveLength(2);
    expect(events[0].full).toBe('第一段第二段');
    expect(events[1].full).toBe('第一段第二段第三段');
    expect(events[1].deltaCount).toBe(2);
  });

  it('上游无响应时按配置超时中止并抛出友好错误', async () => {
    global.fetch = async (_url, opts) => hangingResponse(opts.signal);

    await expect(
      gemini.streamChatCompletions(
        'test-key', 'gemini-2.5-flash',
        [{ role: 'user', content: 'hi' }],
        { timeout_ms: 50 }
      )
    ).rejects.toThrow('AI响应超时');
  });

  it('调用方取消（signal.abort）时抛「已取消」', async () => {
    global.fetch = async (_url, opts) => hangingResponse(opts.signal);

    const caller = new AbortController();
    const p = gemini.streamChatCompletions(
      'test-key', 'gemini-2.5-flash',
      [{ role: 'user', content: 'hi' }],
      {},
      null,
      caller.signal
    );
    setTimeout(() => caller.abort(), 20);

    await expect(p).rejects.toThrow('已取消');
  });

  it('上游 HTTP 错误时抛出状态信息', async () => {
    global.fetch = async () => ({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    });

    await expect(
      gemini.streamChatCompletions('k', 'm', [{ role: 'user', content: 'hi' }], {})
    ).rejects.toThrow('429');
  });
});