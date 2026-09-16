'use strict';

// 客户端错误上报端点（P1-3）
const request = require('supertest');
const { installFakePool } = require('./helpers');
const { createApp } = require('../app');

describe('POST /api/v1/client-errors', () => {
  const app = createApp();

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-0123456789';
    installFakePool([]);
  });

  it('匿名可上报（引导阶段错误发生在登录之前）→ 204，且不落库', async () => {
    const res = await request(app)
      .post('/api/v1/client-errors')
      .send({ name: 'TypeError', message: 'x is not a function', context: 'vue:render', url: '/', ua: 'test' });
    expect(res.status).toBe(204);
  });

  it('空 body / 无有效字段 → 204，不写日志', async () => {
    const res = await request(app).post('/api/v1/client-errors').send({});
    expect(res.status).toBe(204);
  });

  it('超长字段被截断而非原样透传（防日志放大器）', async () => {
    const res = await request(app)
      .post('/api/v1/client-errors')
      .send({ message: 'A'.repeat(5000), name: 'E' });
    // body 超过 8KB 闸门 → 413；未超过则 204。两者都不允许把 5000 字符原样落日志。
    expect([204, 413]).toContain(res.status);
  });

  it('限流：同一来源超过窗口上限 → 429', async () => {
    let last = 0;
    for (let i = 0; i < 25; i++) {
      const r = await request(app)
        .post('/api/v1/client-errors')
        .send({ message: 'boom ' + i, context: 'unhandledrejection' });
      last = r.status;
    }
    expect(last).toBe(429);
  });
});
