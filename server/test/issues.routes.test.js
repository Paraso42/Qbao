'use strict';

const request = require('supertest');
const { installFakePool } = require('./helpers');
const { createApp } = require('../app');
const { signToken } = require('../src/auth');

describe('issues 路由参数校验', () => {
  const app = createApp();
  let token;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-0123456789';
    token = signToken(1, 'user');
    installFakePool([[/SELECT is_banned FROM users/, async () => ({ rows: [] })]]);
  });

  it('创建 Issue 缺少标题 → 422', async () => {
    const res = await request(app)
      .post('/api/v1/issues')
      .set('Authorization', 'Bearer ' + token)
      .send({ content: '内容' });

    expect(res.status).toBe(422);
  });

  it('修改 Issue 标题为空 → 422', async () => {
    const res = await request(app)
      .put('/api/v1/issues/1')
      .set('Authorization', 'Bearer ' + token)
      .send({ title: '' });

    expect(res.status).toBe(422);
  });

  it('状态非法 → 422', async () => {
    const res = await request(app)
      .patch('/api/v1/issues/1/status')
      .set('Authorization', 'Bearer ' + token)
      .send({ status: 'done' });

    expect(res.status).toBe(422);
  });
});
