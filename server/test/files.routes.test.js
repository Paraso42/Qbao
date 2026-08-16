'use strict';

const request = require('supertest');
const { installFakePool } = require('./helpers');
const { createApp } = require('../app');
const { signToken } = require('../src/auth');

describe('files 路由参数校验', () => {
  const app = createApp();
  let token;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-0123456789';
    token = signToken(1, 'user');
    installFakePool([]);
  });

  it('删除文件 id 非数字 → 422', async () => {
    const res = await request(app)
      .delete('/api/v1/files/abc')
      .set('Authorization', 'Bearer ' + token);

    expect(res.status).toBe(422);
  });

  it('分配文件缺少 chapterId → 422', async () => {
    const res = await request(app)
      .post('/api/v1/files/123/assign')
      .set('Authorization', 'Bearer ' + token)
      .send({});

    expect(res.status).toBe(422);
    expect(res.body.error).toContain('chapterId');
  });

  it('列表 pool 参数非法 → 422', async () => {
    const res = await request(app)
      .get('/api/v1/files?pool=yes')
      .set('Authorization', 'Bearer ' + token);

    expect(res.status).toBe(422);
  });
});
