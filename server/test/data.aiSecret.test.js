'use strict';

const request = require('supertest');
const { installFakePool } = require('./helpers');
const { createApp } = require('../app');
const { signToken } = require('../src/auth');

describe('data 路由 AI Key 脱敏', () => {
  const app = createApp();
  let token;
  let capturedPutParams = null;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-0123456789';
    token = signToken(1, 'user');
    capturedPutParams = null;

    installFakePool([
      [/SELECT is_banned FROM users/, async () => ({ rows: [] })],
      [/INSERT INTO user_data \(user_id, state_json\) VALUES/, async (_sql, params) => {
        capturedPutParams = params;
        return { rows: [{ rev: 1 }] };
      }],
      [/SELECT state_json, synced_at, rev FROM user_data/, async () => ({ rows: [] })],
    ]);
  });

  it('PUT /data 时剥离 state_json.aiConfig 中的 apiKey/providerKeys', async () => {
    const res = await request(app)
      .put('/api/v1/data')
      .set('Authorization', 'Bearer ' + token)
      .send({
        state_json: {
          subjects: {},
          aiConfig: {
            provider: 'openai',
            model: 'gpt-4o',
            systemPrompt: '保留',
            apiKey: 'sk-secret',
            providerKeys: { openai: 'sk-secret-2' },
          },
        },
      });

    expect(res.status).toBe(200);
    expect(capturedPutParams).toBeTruthy();
    const stored = capturedPutParams[1];
    expect(stored.aiConfig.provider).toBe('openai');
    expect(stored.aiConfig.systemPrompt).toBe('保留');
    expect(stored.aiConfig.apiKey).toBeUndefined();
    expect(stored.aiConfig.providerKeys).toBeUndefined();
  });

  it('GET /data 时同样不返回历史遗留的 AI Key', async () => {
    installFakePool([
      [/SELECT is_banned FROM users/, async () => ({ rows: [] })],
      [/SELECT state_json, synced_at, rev FROM user_data/, async () => ({
        rows: [{
          state_json: { aiConfig: { provider: 'deepseek', model: 'deepseek-v4-flash', apiKey: 'sk-legacy', providerKeys: { deepseek: 'sk-legacy' } } },
          synced_at: new Date().toISOString(),
          rev: 3,
        }],
      })],
    ]);

    const res = await request(app)
      .get('/api/v1/data')
      .set('Authorization', 'Bearer ' + token);

    expect(res.status).toBe(200);
    expect(res.body.state_json.aiConfig.provider).toBe('deepseek');
    expect(res.body.state_json.aiConfig.apiKey).toBeUndefined();
    expect(res.body.state_json.aiConfig.providerKeys).toBeUndefined();
  });
});
