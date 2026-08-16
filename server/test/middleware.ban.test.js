'use strict';

const request = require('supertest');
const { installFakePool } = require('./helpers');
const { createApp } = require('../app');
const { signToken } = require('../src/auth');
const { invalidateBannedCache } = require('../src/middleware');

describe('封禁用户鉴权', () => {
  const app = createApp();
  let token;

  beforeEach(() => {
    invalidateBannedCache(1);
    invalidateBannedCache(2);
    process.env.JWT_SECRET = 'test-secret-0123456789';
    token = signToken(1, 'user');
  });

  it('封禁用户访问受保护接口立即 403，不再继续路由', async () => {
    installFakePool([[/SELECT is_banned FROM users/, async () => ({
      rows: [{ is_banned: true }],
    })]]);

    const res = await request(app)
      .get('/api/v1/data')
      .set('Authorization', 'Bearer ' + token);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('账号已被封禁');
  });

  it('未封禁用户正常放行', async () => {
    token = signToken(2, 'user');
    installFakePool([
      [/SELECT is_banned FROM users/, async () => ({ rows: [{ is_banned: false }] })],
      [/SELECT state_json, synced_at, rev FROM user_data/, async () => ({ rows: [] })],
    ]);

    const res = await request(app)
      .get('/api/v1/data')
      .set('Authorization', 'Bearer ' + token);

    expect(res.status).toBe(200);
  });
});
