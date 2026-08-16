'use strict';

const request = require('supertest');
const { installFakePool } = require('./helpers');
const { createApp } = require('../app');
const { signToken } = require('../src/auth');

describe('users 路由参数校验', () => {
  const app = createApp();
  let token;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-0123456789';
    token = signToken(1, 'user');
    installFakePool([[/SELECT is_banned FROM users/, async () => ({ rows: [] })]]);
  });

  it('修改昵称过长 → 422', async () => {
    const res = await request(app)
      .put('/api/v1/users/me')
      .set('Authorization', 'Bearer ' + token)
      .send({ displayName: 'x'.repeat(200) });

    expect(res.status).toBe(422);
  });

  it('封禁请求缺少 banned → 422', async () => {
    const res = await request(app)
      .patch('/api/v1/users/1/ban')
      .set('Authorization', 'Bearer ' + token)
      .send({});

    expect(res.status).toBe(422);
  });

  it('管理员修改用户角色非法 → 422', async () => {
    const res = await request(app)
      .put('/api/v1/users/1')
      .set('Authorization', 'Bearer ' + token)
      .send({ role: 'superadmin' });

    expect(res.status).toBe(422);
  });
});
