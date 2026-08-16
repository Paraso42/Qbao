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
});
