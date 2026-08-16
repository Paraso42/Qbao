'use strict';

const request = require('supertest');
const { installFakePool } = require('./helpers');
const { createApp } = require('../app');

describe('管理员引导注册', () => {
  const app = createApp();

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-0123456789';
  });

  it('库中无管理员时，第一个注册用户自动成为 admin', async () => {
    let insertedRole = null;
    installFakePool([
      [/SELECT 1 FROM users WHERE role = 'admin'/, async () => ({ rows: [] })],
      [/INSERT INTO users \(username, password_hash, display_name, role\)/, async (_sql, params) => {
        insertedRole = params[3];
        return { rows: [{ id: 1, username: params[0], display_name: params[2], role: params[3], avatar_url: null }] };
      }],
    ]);

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ username: 'firstuser', password: '123456', displayName: 'First' });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('admin');
    expect(insertedRole).toBe('admin');
  });

  it('已有管理员时，新注册用户为普通 user', async () => {
    installFakePool([
      [/SELECT 1 FROM users WHERE role = 'admin'/, async () => ({ rows: [{ '?column?': 1 }] })],
      [/INSERT INTO users \(username, password_hash, display_name, role\)/, async (_sql, params) => ({
        rows: [{ id: 2, username: params[0], display_name: params[2], role: params[3], avatar_url: null }],
      })],
    ]);

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ username: 'seconduser', password: '123456', displayName: 'Second' });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('user');
  });
});
