'use strict';

// points 路由测试：校验层（422/401/403）+ 成就领取 + 台账 + 管理员调整。
// 注：调整接口内部使用 pool.connect 独立事务，此处通过临时替换 connect 模拟。

const request = require('supertest');
const { installFakePool } = require('./helpers');
const { createApp } = require('../app');
const { signToken } = require('../src/auth');
const { pool } = require('../src/db');

const LEDGER_ROW = {
  id: 1, delta: 20, balance_after: 20, reason: 'signup',
  ref_type: 'signup', ref_id: 'user:1', note: '', created_at: new Date().toISOString(),
};

function authPool() {
  installFakePool([[ /SELECT is_banned FROM users/, async () => ({ rows: [] }) ]]);
}

describe('points 路由校验', () => {
  const app = createApp();
  let token;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-0123456789';
    token = signToken(1, 'user');
    authPool();
  });

  it('未登录访问台账 → 401', async () => {
    const res = await request(app).get('/api/v1/points/ledger');
    expect(res.status).toBe(401);
  });

  it('claim 缺 refId → 422', async () => {
    const res = await request(app)
      .post('/api/v1/points/claims')
      .set('Authorization', 'Bearer ' + token)
      .send({ type: 'achievement' });
    expect(res.status).toBe(422);
  });

  it('claim type 非法 → 422', async () => {
    const res = await request(app)
      .post('/api/v1/points/claims')
      .set('Authorization', 'Bearer ' + token)
      .send({ type: 'bad', refId: 'first_step' });
    expect(res.status).toBe(422);
  });

  it('claim 未知成就 → 400', async () => {
    const res = await request(app)
      .post('/api/v1/points/claims')
      .set('Authorization', 'Bearer ' + token)
      .send({ type: 'achievement', refId: 'not_exist_achievement' });
    expect(res.status).toBe(400);
  });

  it('台账分页参数非法（limit=101）→ 422', async () => {
    const res = await request(app)
      .get('/api/v1/points/ledger?limit=101')
      .set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(422);
  });

  it('管理员调整：非管理员 → 403', async () => {
    const res = await request(app)
      .post('/api/v1/users/1/points/adjust')
      .set('Authorization', 'Bearer ' + token)
      .send({ delta: 10, note: '测试' });
    expect(res.status).toBe(403);
  });
});

describe('points 业务路径', () => {
  const app = createApp();
  let token;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-0123456789';
    token = signToken(1, 'user');
  });

  it('claim 成功：发分并返回余额', async () => {
    installFakePool([
      [/SELECT is_banned FROM users/, async () => ({ rows: [] })],
      [/UPDATE users SET storage_points = storage_points \+/, async () => ({ rows: [{ storage_points: 30 }] })],
      [/INSERT INTO points_ledger/, async () => ({ rows: [{ id: 1 }] })],
    ]);
    const res = await request(app)
      .post('/api/v1/points/claims')
      .set('Authorization', 'Bearer ' + token)
      .send({ type: 'achievement', refId: 'first_step' });
    expect(res.status).toBe(200);
    expect(res.body.awarded).toBe(true);
    expect(res.body.points).toBe(10);
    expect(res.body.balance).toBe(30);
  });

  it('GET /points/balance 返回余额', async () => {
    installFakePool([
      [/SELECT is_banned FROM users/, async () => ({ rows: [] })],
      [/SELECT storage_points FROM users/, async () => ({ rows: [{ storage_points: 5 }] })],
    ]);
    const res = await request(app)
      .get('/api/v1/points/balance')
      .set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(200);
    expect(res.body.balance).toBe(5);
  });

  it('GET /points/rules 返回规则与清零信息', async () => {
    authPool();
    const res = await request(app)
      .get('/api/v1/points/rules')
      .set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(200);
    expect(res.body.earn.length).toBeGreaterThan(0);
    expect(res.body.spend.length).toBeGreaterThan(0);
    expect(res.body.nextExpiry.date).toBeTruthy();
  });

  it('GET /points/quota 返回 AI 配额', async () => {
    installFakePool([
      [/SELECT is_banned FROM users/, async () => ({ rows: [] })],
      [/SELECT COUNT\(\*\)::int AS c FROM ai_request_log/, async () => ({ rows: [{ c: 3 }] })],
      [/SELECT COUNT\(\*\)::int AS c FROM ai_tasks/, async () => ({ rows: [{ c: 1 }] })],
    ]);
    const res = await request(app)
      .get('/api/v1/points/quota')
      .set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(200);
    expect(res.body.aiGenerateUsed).toBe(4);
    expect(res.body.aiGenerateFree).toBeGreaterThan(0);
  });

  it('GET /points/ledger 返回台账分页', async () => {
    installFakePool([
      [/SELECT is_banned FROM users/, async () => ({ rows: [] })],
      [/SELECT COUNT\(\*\)::int AS c FROM points_ledger/, async () => ({ rows: [{ c: 1 }] })],
      [/SELECT id, delta, balance_after/, async () => ({ rows: [LEDGER_ROW] })],
    ]);
    const res = await request(app)
      .get('/api/v1/points/ledger?page=1&limit=20')
      .set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].delta).toBe(20);
    expect(res.body.items[0].reason).toBe('signup');
  });

  it('管理员调整成功（mock pool.connect 事务）', async () => {
    installFakePool([[ /SELECT is_banned FROM users/, async () => ({ rows: [] }) ]]);
    const txn = { calls: [], release: () => {} };
    txn.query = async (sql) => {
      txn.calls.push(sql);
      if (/^BEGIN/.test(sql)) return {};
      if (/UPDATE users SET storage_points = storage_points \+/.test(sql)) return { rows: [{ storage_points: 55 }] };
      if (/INSERT INTO points_ledger/.test(sql)) return { rows: [{ id: 1 }] };
      if (/COMMIT/.test(sql)) return {};
      return { rows: [] };
    };
    const origConnect = pool.connect;
    pool.connect = async () => txn;
    const adminToken = signToken(9, 'admin');
    try {
      const res = await request(app)
        .post('/api/v1/users/7/points/adjust')
        .set('Authorization', 'Bearer ' + adminToken)
        .send({ delta: 15, note: '测试调整' });
      expect(res.status).toBe(200);
      expect(res.body.balance).toBe(55);
      expect(txn.calls.join('\n')).toContain('BEGIN');
      expect(txn.calls.join('\n')).toContain('COMMIT');
    } finally {
      pool.connect = origConnect;
    }
  });

  it('管理员调整：delta=0 → 422', async () => {
    installFakePool([[ /SELECT is_banned FROM users/, async () => ({ rows: [] }) ]]);
    const adminToken = signToken(9, 'admin');
    const res = await request(app)
      .post('/api/v1/users/7/points/adjust')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ delta: 0, note: 'x' });
    expect(res.status).toBe(422);
  });

  it('管理员查看任意用户台账 → 200', async () => {
    installFakePool([
      [/SELECT COUNT\(\*\)::int AS c FROM points_ledger/, async () => ({ rows: [{ c: 2 }] })],
      [/SELECT id, delta, balance_after/, async () => ({ rows: [LEDGER_ROW, { ...LEDGER_ROW, id: 2, delta: -10, balance_after: 10, reason: 'file_extend' }] })],
    ]);
    const adminToken = signToken(9, 'admin');
    const res = await request(app)
      .get('/api/v1/users/7/points/ledger')
      .set('Authorization', 'Bearer ' + adminToken);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
  });
});
