'use strict';

const request = require('supertest');
const { installFakePool } = require('./helpers');
const { createApp } = require('../app');

describe('notices 路由参数校验', () => {
  const app = createApp();

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-0123456789';
    installFakePool([]);
  });

  it('公开公告列表正常返回 200', async () => {
    installFakePool([[/FROM notices/, async () => ({ rows: [] })]]);
    const res = await request(app).get('/api/v1/notices');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('新增公告内容为空 → 422', async () => {
    const res = await request(app)
      .post('/api/v1/notices')
      .send({ content: '' });

    expect(res.status).toBe(422);
  });
});
