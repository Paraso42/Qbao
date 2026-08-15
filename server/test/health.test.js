'use strict';

const request = require('supertest');
const { installFakePool } = require('./helpers');
const { createApp } = require('../app');

describe('GET /health', () => {
  const app = createApp();

  it('数据库正常 → 200 ok', async () => {
    installFakePool([[/SELECT 1/, async () => ({ rows: [{ '?column?': 1 }] })]]);
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.db).toBe('connected');
  });

  it('数据库断开 → 503', async () => {
    installFakePool([[/SELECT 1/, async () => { throw new Error('connection refused'); }]]);
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('error');
    expect(res.body.db).toBe('disconnected');
  });
});
