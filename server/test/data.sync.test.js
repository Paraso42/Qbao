'use strict';

const request = require('supertest');
const { installFakePool } = require('./helpers');
const { createApp } = require('../app');
const { signToken } = require('../src/auth');

describe('data 同步（rev 乐观锁）', () => {
  const app = createApp();
  let token;
  let cloud; // 模拟云端行 { state_json, synced_at, rev }

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-0123456789';
    token = signToken(1, 'user');
    cloud = { state_json: { banks: [{ id: 'b1', name: '旧' }] }, synced_at: new Date().toISOString(), rev: 5 };
    installFakePool([
      [/SELECT state_json, synced_at, rev FROM user_data/, async () => ({ rows: cloud ? [cloud] : [] })],
      [/SELECT rev, synced_at FROM user_data/, async () => ({ rows: cloud ? [{ rev: cloud.rev, synced_at: cloud.synced_at }] : [] })],
      [/SELECT is_banned FROM users/, async () => ({ rows: [] })],
      [/UPDATE user_data SET state_json = \$2, rev = rev \+ 1.*RETURNING rev/, async (sql, params) => {
        if (params[2] === cloud.rev) {
          cloud.rev += 1;
          return { rows: [{ rev: cloud.rev }] };
        }
        return { rows: [] };
      }],
      [/INSERT INTO user_data \(user_id, state_json\) VALUES/, async () => ({ rows: [{ rev: cloud ? cloud.rev + 1 : 1 }] })],
      [/INSERT INTO user_data \(user_id, state_json, rev\)/, async () => ({ rows: [] })],
    ]);
  });

  it('未登录 → 401', async () => {
    const res = await request(app).get('/api/v1/data');
    expect(res.status).toBe(401);
  });

  it('无云端数据 → 默认空状态 rev=1', async () => {
    cloud = null;
    const res = await request(app).get('/api/v1/data').set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(200);
    expect(res.body.state_json).toEqual({});
    expect(res.body.rev).toBe(1);
  });

  it('GET /data/rev 返回轻量版本号', async () => {
    const res = await request(app).get('/api/v1/data/rev').set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(200);
    expect(res.body.rev).toBe(5);
    expect(res.body.synced_at).toBeTruthy();
    expect(res.body.state_json).toBeUndefined();
  });

  it('GET /data/rev 无数据 → rev=1', async () => {
    cloud = null;
    const res = await request(app).get('/api/v1/data/rev').set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(200);
    expect(res.body.rev).toBe(1);
  });

  it('rev 匹配 → 更新成功并自增', async () => {
    const res = await request(app)
      .put('/api/v1/data')
      .set('Authorization', 'Bearer ' + token)
      .send({ state_json: { banks: [] }, rev: 5 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.rev).toBe(6);
  });

  it('rev 冲突 → 409 携带 current 快照', async () => {
    const res = await request(app)
      .put('/api/v1/data')
      .set('Authorization', 'Bearer ' + token)
      .send({ state_json: { banks: [] }, rev: 3 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('数据版本冲突');
    expect(res.body.current.rev).toBe(5);
  });

  it('旧客户端不带 rev → 兼容覆盖', async () => {
    const res = await request(app)
      .put('/api/v1/data')
      .set('Authorization', 'Bearer ' + token)
      .send({ state_json: { banks: [] } });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('缺少 state_json → 422（校验先于鉴权）', async () => {
    const res = await request(app).put('/api/v1/data').send({ rev: 1 });
    expect(res.status).toBe(422);
    expect(res.body.error).toContain('state_json');
  });

  it('PATCH 缺 section → 422', async () => {
    const res = await request(app).patch('/api/v1/data/section').send({ data: { a: 1 } });
    expect(res.status).toBe(422);
    expect(res.body.error).toContain('section');
  });

  it('PATCH rev 匹配 → 部分更新成功', async () => {
    const res = await request(app)
      .patch('/api/v1/data/section')
      .set('Authorization', 'Bearer ' + token)
      .send({ section: 'settings', data: { theme: 'dark' }, rev: 5 });
    expect(res.status).toBe(200);
    expect(res.body.rev).toBe(6);
  });

  it('PATCH rev 冲突 → 409', async () => {
    const res = await request(app)
      .patch('/api/v1/data/section')
      .set('Authorization', 'Bearer ' + token)
      .send({ section: 'settings', data: { theme: 'dark' }, rev: 2 });
    expect(res.status).toBe(409);
    expect(res.body.current.rev).toBe(5);
  });
});
