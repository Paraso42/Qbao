'use strict';

// 本轮复查 P0-1 回归：聊天附件 / 工单图片的下载鉴权。
// 覆盖 lib/mediaToken.js 的签名、验签、过期、篡改，以及路由守卫的两种凭证。

const crypto = require('crypto');
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { installFakePool } = require('./helpers');
const { createApp } = require('../app');
const { signToken } = require('../src/auth');
const { signToken: signMedia, verifyToken, signUrl, sanitizeMediaUrl, sanitizeMessageRows } = require('../src/lib/mediaToken');

const CHAT_UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'chat');
const ISSUE_UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'issues');

describe('媒体下载签名 ticket（P0-1）', () => {
  const created = [];
  function track(p) { if (p) created.push(String(p).split('?')[0]); }

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-0123456789';
    installFakePool([]);
  });
  afterEach(() => {
    for (const f of created.splice(0)) { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {} }
    delete process.env.JWT_SECRET;
  });

  it('签发 → 验签通过', () => {
    const t = signMedia('chat_1_abc.png');
    expect(t).toMatch(/^\d+\.[A-Za-z0-9_-]+$/);
    expect(verifyToken('chat_1_abc.png', t)).toBe(true);
  });

  it('文件名不匹配 → 验签失败（ticket 不能跨文件复用）', () => {
    const t = signMedia('chat_1_abc.png');
    expect(verifyToken('chat_2_def.png', t)).toBe(false);
  });

  it('篡改签名 / 篡改过期时间 → 验签失败', () => {
    const t = signMedia('chat_1_abc.png');
    const [exp, mac] = t.split('.');
    expect(verifyToken('chat_1_abc.png', exp + '.' + mac.slice(0, -1) + (mac.endsWith('A') ? 'B' : 'A'))).toBe(false);
    expect(verifyToken('chat_1_abc.png', (Number(exp) + 60000) + '.' + mac)).toBe(false);
  });

  it('已过期的 ticket → 验签失败', () => {
    const t = signMedia('chat_1_abc.png', -1000);
    expect(verifyToken('chat_1_abc.png', t)).toBe(false);
  });

  it('空 ticket / 非法格式 → 验签失败（不抛异常）', () => {
    for (const bad of ['', null, undefined, '.', 'abc', '123.', '.abc', 'notanumber.zzz']) {
      expect(verifyToken('chat_1_abc.png', bad)).toBe(false);
    }
  });

  it('换密钥后旧 ticket 失效', () => {
    const t = signMedia('chat_1_abc.png');
    process.env.JWT_SECRET = 'another-secret-0123456789';
    expect(verifyToken('chat_1_abc.png', t)).toBe(false);
  });

  it('signUrl 只处理两个业务媒体前缀，其它 URL 原样返回', () => {
    expect(signUrl('/api/v1/chat/files/a.png')).toMatch(/^\/api\/v1\/chat\/files\/a\.png\?t=/);
    expect(signUrl('/api/v1/issues/images/b.png')).toMatch(/\?t=/);
    expect(signUrl('https://cdn.example/a.png')).toBe('https://cdn.example/a.png');
    expect(signUrl('/avatars/1.jpg')).toBe('/avatars/1.jpg');
    expect(signUrl('')).toBe('');
    expect(signUrl(null)).toBe(null);
  });

  it('sanitizeMediaUrl 幂等：旧数据里已带 ticket 的路径会被换成新 ticket', () => {
    const once = sanitizeMediaUrl('/api/v1/chat/files/a.png');
    const twice = sanitizeMediaUrl(once);
    expect(twice).toMatch(/^\/api\/v1\/chat\/files\/a\.png\?t=/);
    expect(twice.indexOf('?t=', twice.indexOf('?t=') + 1)).toBe(-1);
  });

  it('sanitizeMessageRows 同时处理 images 与 file_info.url，且不碰 quiz_data', () => {
    const rows = [{
      images: ['/api/v1/chat/files/a.png', 'https://cdn.example/x.png'],
      file_info: { name: 'f.pdf', size: 1, url: '/api/v1/chat/files/f.pdf' },
      quiz_data: { images: ['/api/v1/chat/files/keep.png'] },
    }];
    sanitizeMessageRows(rows);
    expect(rows[0].images[0]).toMatch(/\?t=/);
    expect(rows[0].images[1]).toBe('https://cdn.example/x.png');
    expect(rows[0].file_info.url).toMatch(/\?t=/);
    expect(rows[0].quiz_data.images[0]).toBe('/api/v1/chat/files/keep.png');
  });

  it('GET /chat/files/:name 支持 Bearer 与有效 ticket 两种凭证', async () => {
    const app = createApp();
    const fname = 'chat_mediatoken_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.txt';
    const abs = path.join(CHAT_UPLOAD_DIR, fname);
    fs.writeFileSync(abs, 'hello');
    track(abs);

    expect((await request(app).get('/api/v1/chat/files/' + fname)).status).toBe(401);
    expect((await request(app).get('/api/v1/chat/files/' + fname + '?t=forged.sig')).status).toBe(401);
    expect((await request(app).get('/api/v1/chat/files/' + fname + '?t=' + signMedia(fname))).status).toBe(200);
    expect((await request(app).get('/api/v1/chat/files/' + fname).set('Authorization', 'Bearer ' + signToken(1, 'user'))).status).toBe(200);
    // ticket 与文件名绑定：换文件名的 ticket 无效
    expect((await request(app).get('/api/v1/chat/files/' + fname + '?t=' + signMedia('other.txt'))).status).toBe(401);
  });

  it('GET /issues/images/:name 支持 Bearer 与有效 ticket 两种凭证', async () => {
    const app = createApp();
    const fname = 'issue_mediatoken_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.png';
    const abs = path.join(ISSUE_UPLOAD_DIR, fname);
    fs.writeFileSync(abs, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    track(abs);

    expect((await request(app).get('/api/v1/issues/images/' + fname)).status).toBe(401);
    expect((await request(app).get('/api/v1/issues/images/' + fname + '?t=' + signMedia(fname))).status).toBe(200);
    expect((await request(app).get('/api/v1/issues/images/' + fname).set('Authorization', 'Bearer ' + signToken(1, 'user'))).status).toBe(200);
  });

  it('ticket 通过后仍保留路径穿越防护', async () => {
    const app = createApp();
    const t = signMedia('..%2F..%2Fetc%2Fpasswd');
    const res = await request(app).get('/api/v1/chat/files/..%2F..%2Fetc%2Fpasswd?t=' + t);
    expect([400, 401, 404]).toContain(res.status);
  });
});
