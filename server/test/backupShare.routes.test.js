'use strict';

const request = require('supertest');
const { installFakePool } = require('./helpers');
const { createApp } = require('../app');
const { signToken } = require('../src/auth');

describe('backup/share 路由参数校验', () => {
  const app = createApp();
  let token;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-0123456789';
    token = signToken(1, 'user');
    installFakePool([]);
  });

  it('创建分享缺少 questions → 422', async () => {
    const res = await request(app)
      .post('/api/v1/share')
      .set('Authorization', 'Bearer ' + token)
      .send({ name: '分享名' });

    expect(res.status).toBe(422);
  });

  it('创建备份 label 过长 → 422', async () => {
    const res = await request(app)
      .post('/api/v1/backup')
      .set('Authorization', 'Bearer ' + token)
      .send({ label: 'x'.repeat(300) });

    expect(res.status).toBe(422);
  });

  it('获取备份 id 非数字 → 422', async () => {
    const res = await request(app)
      .get('/api/v1/backup/abc')
      .set('Authorization', 'Bearer ' + token);

    expect(res.status).toBe(422);
  });
});
