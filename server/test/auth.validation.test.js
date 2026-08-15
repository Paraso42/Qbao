'use strict';

const request = require('supertest');
const { installFakePool } = require('./helpers');
const { createApp } = require('../app');

describe('auth 参数校验', () => {
  const app = createApp();
  beforeEach(() => installFakePool([]));

  it('注册缺字段 → 422', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({});
    expect(res.status).toBe(422);
    expect(res.body.error).toContain('用户名');
  });

  it('用户名过短 → 422', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({ username: 'ab', password: '123456' });
    expect(res.status).toBe(422);
    expect(res.body.error).toContain('3 个字符');
  });

  it('密码过短 → 422', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({ username: 'abc', password: '123' });
    expect(res.status).toBe(422);
    expect(res.body.error).toContain('6 位');
  });

  it('登录缺密码 → 422', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ username: 'abc' });
    expect(res.status).toBe(422);
    expect(res.body.error).toContain('密码');
  });
});
