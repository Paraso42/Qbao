'use strict';

// 优雅停机（P1-7）
const { createShutdownHandler } = require('../src/lib/gracefulShutdown');

function deps(over) {
  const calls = { stopAi: 0, stopExpiry: 0, drained: 0, pooled: 0, exits: [] };
  const base = {
    server: { close: (cb) => { calls.closed = true; setImmediate(() => cb && cb()); } },
    pool: { end: async () => { calls.pooled++ } },
    stopAiTaskWorker: () => { calls.stopAi++ },
    stopExpiryJob: () => { calls.stopExpiry++ },
    drainAiTaskWorker: async () => { calls.drained++; return true },
    logger: { log() {}, warn() {} },
    graceMs: 200,
    exit: (code) => { calls.exits.push(code) },
    calls,
  };
  return Object.assign(base, over || {});
}

describe('优雅停机', () => {
  it('收到 SIGTERM：停定时器 → 关连接 → 等在途 → 关连接池 → exit(0)', async () => {
    const d = deps();
    await createShutdownHandler(d)('SIGTERM');
    expect(d.calls.stopAi).toBe(1);
    expect(d.calls.stopExpiry).toBe(1);
    expect(d.calls.closed).toBe(true);
    expect(d.calls.drained).toBe(1);
    expect(d.calls.pooled).toBe(1);
    expect(d.calls.exits).toEqual([0]);
  });

  it('第二个信号 → 立即强制退出（不重复走完整流程）', async () => {
    const d = deps({ drainAiTaskWorker: () => new Promise(() => {}) }); // 永不结束
    const handler = createShutdownHandler(d);
    const first = handler('SIGTERM');
    await handler('SIGINT'); // 第二次：直接 exit
    expect(d.calls.exits).toEqual([0]);
    expect(d.calls.stopAi).toBe(1); // 定时器只停一次
    void first;
  });

  it('在途任务超过宽限期 → 仍然完成停机（不无限等待）', async () => {
    const d = deps({ graceMs: 30, drainAiTaskWorker: () => new Promise(() => {}) });
    const t0 = Date.now();
    await createShutdownHandler(d)('SIGTERM');
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(d.calls.pooled).toBe(1);
    expect(d.calls.exits).toEqual([0]);
  });

  it('drain 抛错 / 连接池关闭抛错 → 停机流程不中断', async () => {
    const d = deps({
      drainAiTaskWorker: async () => { throw new Error('drain boom') },
      pool: { end: async () => { throw new Error('pool boom') } },
    });
    await createShutdownHandler(d)('SIGTERM');
    expect(d.calls.exits).toEqual([0]);
  });
});
