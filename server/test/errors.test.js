'use strict';

const request = require('supertest');
const { createApp } = require('../app');

describe('统一错误处理（集成）', () => {
  const app = createApp();

  it('未知路由 → 404 JSON', async () => {
    const res = await request(app).get('/api/v1/not-a-route');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('接口不存在');
  });

  it('坏 JSON → 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"username": bad');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('JSON');
  });
});
