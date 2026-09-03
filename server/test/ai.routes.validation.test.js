'use strict';

const request = require('supertest');
const { installFakePool } = require('./helpers');
const { createApp } = require('../app');
const { signToken } = require('../src/auth');

describe('AI 路由参数与 Provider 校验', () => {
  const app = createApp();
  let token;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-0123456789';
    token = signToken(1, 'user');
    installFakePool([[/SELECT is_banned FROM users/, async () => ({ rows: [] })]]);
  });

  it('typeCounts 非法类型 → 422', async () => {
    const res = await request(app)
      .post('/api/v1/ai/generate')
      .set('Authorization', 'Bearer ' + token)
      .send({ textContent: '资料', typeCounts: { single: 'many' } });

    expect(res.status).toBe(422);
  });

  it('单次生成超过 200 题 → 422', async () => {
    const res = await request(app)
      .post('/api/v1/ai/generate')
      .set('Authorization', 'Bearer ' + token)
      .send({ typeCounts: { single: 50, judge: 50, term: 50, short: 51 } });

    expect(res.status).toBe(422);
  });

  it('缺少 AI API Key → 401', async () => {
    const res = await request(app)
      .post('/api/v1/ai/generate')
      .set('Authorization', 'Bearer ' + token)
      .set('x-ai-provider', 'ecnu')
      .set('x-ai-model', 'ecnu-plus')
      .send({ textContent: '资料', typeCounts: { single: 1 } });

    expect(res.status).toBe(401);
    expect(res.body.error).toContain('AI API Key');
  });

  it('未知 Provider → 422，不再静默回退', async () => {
    const res = await request(app)
      .post('/api/v1/ai/generate')
      .set('Authorization', 'Bearer ' + token)
      .set('x-ai-api-key', 'sk-test-key-1234567890')
      .set('x-ai-provider', 'unknown-provider')
      .set('x-ai-model', 'some-model')
      .send({ textContent: '资料', typeCounts: { single: 1 } });

    expect(res.status).toBe(422);
    expect(res.body.error).toContain('未知 AI 供应商');
  });

  it('Provider 与模型不匹配 → 422', async () => {
    const res = await request(app)
      .post('/api/v1/ai/generate')
      .set('Authorization', 'Bearer ' + token)
      .set('x-ai-api-key', 'sk-test-key-1234567890')
      .set('x-ai-provider', 'deepseek')
      .set('x-ai-model', 'gpt-4o')
      .send({ textContent: '资料', typeCounts: { single: 1 } });

    expect(res.status).toBe(422);
    expect(res.body.error).toContain('模型与供应商不匹配');
  });

  it('/ai/test 未知 Provider → 422', async () => {
    const res = await request(app)
      .post('/api/v1/ai/test')
      .set('Authorization', 'Bearer ' + token)
      .set('x-ai-api-key', 'sk-test-key-1234567890')
      .set('x-ai-provider', 'nope')
      .set('x-ai-model', 'nope-model')
      .send({ message: 'ping' });

    expect(res.status).toBe(422);
  });

  it('P0.8 上传超出配额 → 400 且 multer 落盘文件被清理（无磁盘残留）', async () => {
    const fs = require('fs');
    const path = require('path');
    const uploadRoot = path.join(__dirname, '..', '..', 'uploads');
    if (!fs.existsSync(uploadRoot)) fs.mkdirSync(uploadRoot, { recursive: true });
    const before = fs.readdirSync(uploadRoot).length;
    installFakePool([
      [/SELECT is_banned FROM users/, async () => ({ rows: [] })],
      // 已用完当日免费解析次数 → 走扣费；余额不足 → ApiError 400
      [/SELECT COUNT\(\*\)::int AS c FROM ai_request_log/, async () => ({ rows: [{ c: 20 }] })],
      [/UPDATE users SET storage_points = storage_points -/, async () => ({ rows: [] })],
      [/SELECT storage_points FROM users/, async () => ({ rows: [{ storage_points: 2 }] })],
    ]);
    // P0.7 后配额检查在真实 pool 上走事务；helpers 默认把 pool.connect 也 stub 成
    // fake client，测试封闭（不触真实 PostgreSQL），失败路径应 400 并清理落盘文件。
    const res = await request(app)
      .post('/api/v1/ai/upload')
      .set('Authorization', 'Bearer ' + token)
      .attach('files', Buffer.from('quota-fail-sample-content'), { filename: 'sample.txt' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('积分不足');
    const after = fs.readdirSync(uploadRoot).length;
    expect(after).toBe(before); // 配额失败路径已清理本次落盘文件
  });
});
