'use strict';

const request = require('supertest');
const { installFakePool } = require('./helpers');
const { createApp } = require('../app');
const { signToken } = require('../src/auth');

describe('quiz 路由校验与错误', () => {
  const app = createApp();
  let token;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-0123456789';
    token = signToken(1, 'user');
    installFakePool([]);
  });

  it('提交会话缺 chapterId → 422', async () => {
    const res = await request(app).post('/api/v1/quiz/session').send({ questions: [] });
    expect(res.status).toBe(422);
    expect(res.body.error).toContain('chapterId');
  });

  it('非法 status → 422', async () => {
    const res = await request(app).post('/api/v1/quiz/session').send({ chapterId: 'ch1', status: 'done' });
    expect(res.status).toBe(422);
    expect(res.body.error).toContain('status');
  });

  it('列表 status 参数非法 → 422', async () => {
    const res = await request(app).get('/api/v1/quiz/sessions?status=done');
    expect(res.status).toBe(422);
  });

  it('会话 id 非数字 → 422', async () => {
    const res = await request(app).get('/api/v1/quiz/session/abc');
    expect(res.status).toBe(422);
    expect(res.body.error).toContain('id');
  });

  it('会话不存在 → 404', async () => {
    const res = await request(app)
      .get('/api/v1/quiz/session/123')
      .set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('会话不存在');
  });
});
