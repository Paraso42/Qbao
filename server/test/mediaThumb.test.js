'use strict';

// v3.37.6 回归：
//  1) 列表缩略图：上传时可带 thumb 字段，下载端点 ?w=480 命中派生图，
//     缺失时静默回退原图（老消息不改库表也不裂图）；
//  2) 票据稳定性：默认签发落在 30 分钟时间桶里，同一张图在一段时间内 URL 完全一致
//     —— 否则浏览器缓存键每次都变，缓存命中率永远是 0（「打开带图聊天极慢」的根因之一）。

const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { installFakePool } = require('./helpers');
const { createApp } = require('../app');
const { signToken } = require('../src/auth');
const { signToken: signMedia, verifyToken, TTL_MS, BUCKET_MS } = require('../src/lib/mediaToken');

const CHAT_UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'chat');

const PNG_HEAD = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
];
function png(fill, extra) {
  return Buffer.concat([Buffer.from(PNG_HEAD), Buffer.alloc(extra || 0, fill)]);
}
const MAIN_BYTES = png(0xaa, 64);   // 80 字节
const THUMB_BYTES = png(0xbb, 8);   // 24 字节

function binaryParser(res, cb) {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

describe('列表缩略图与票据稳定性（v3.37.6）', () => {
  const app = createApp();
  const created = [];
  let token;

  function track(p) { if (p) created.push(p); }
  function trackUrl(u) {
    if (!u) return;
    const name = path.basename(String(u).split('?')[0]);
    track(path.join(CHAT_UPLOAD_DIR, name));
    // 派生图可能换了扩展名，按候选表一并清理
    const dot = name.lastIndexOf('.');
    const base = dot === -1 ? name : name.slice(0, dot);
    for (const e of ['.png', '.jpg', '.jpeg', '.gif', '.webp']) {
      track(path.join(CHAT_UPLOAD_DIR, base + '.w480' + e));
    }
  }

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-0123456789';
    token = signToken(1, 'user');
    installFakePool([]);
  });
  afterEach(() => {
    for (const f of created.splice(0)) { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {} }
  });

  it('票据落在时间桶里：同一张图连续签发的 URL 完全相同', () => {
    const a = signMedia('chat_1_abc.png');
    const b = signMedia('chat_1_abc.png');
    expect(a).toBe(b);
    expect(verifyToken('chat_1_abc.png', a)).toBe(true);
  });

  it('桶对齐不缩短有效期：实际有效期在 60~90 分钟之间', () => {
    const t = signMedia('chat_1_abc.png');
    const exp = Number(t.split('.')[0]);
    const left = exp - Date.now();
    expect(left).toBeGreaterThanOrEqual(TTL_MS);
    expect(left).toBeLessThanOrEqual(TTL_MS + BUCKET_MS + 1000);
  });

  it('带 thumb 上传 → ?w=480 发小图，不带 w 发原图', async () => {
    const up = await request(app)
      .post('/api/v1/chat/upload')
      .set('Authorization', 'Bearer ' + token)
      .attach('file', MAIN_BYTES, 'photo.png')
      .attach('thumb', THUMB_BYTES, 'photo.png');
    expect(up.status).toBe(200);
    trackUrl(up.body.url);
    const fname = path.basename(up.body.url.split('?')[0]);

    const full = await request(app).get('/api/v1/chat/files/' + fname).set('Authorization', 'Bearer ' + token).buffer(true).parse(binaryParser);
    expect(full.status).toBe(200);
    expect(full.body.length).toBe(MAIN_BYTES.length);

    const thumb = await request(app).get('/api/v1/chat/files/' + fname + '?w=480').set('Authorization', 'Bearer ' + token).buffer(true).parse(binaryParser);
    expect(thumb.status).toBe(200);
    expect(thumb.body.length).toBe(THUMB_BYTES.length);

    // 白名单之外的宽度一律回原图
    const bogus = await request(app).get('/api/v1/chat/files/' + fname + '?w=9999').set('Authorization', 'Bearer ' + token).buffer(true).parse(binaryParser);
    expect(bogus.status).toBe(200);
    expect(bogus.body.length).toBe(MAIN_BYTES.length);
  });

  it('?w= 不影响票据校验：票按原文件名校验，/?w=480 带票可用', async () => {
    const up = await request(app)
      .post('/api/v1/chat/upload')
      .set('Authorization', 'Bearer ' + token)
      .attach('file', MAIN_BYTES, 'photo.png')
      .attach('thumb', THUMB_BYTES, 'photo.png');
    trackUrl(up.body.url);
    const fname = path.basename(up.body.url.split('?')[0]);
    const t = up.body.url.split('?t=')[1];

    expect((await request(app).get('/api/v1/chat/files/' + fname)).status).toBe(401);
    expect((await request(app).get('/api/v1/chat/files/' + fname + '?t=' + t)).status).toBe(200);
    expect((await request(app).get('/api/v1/chat/files/' + fname + '?t=' + t + '&w=480')).status).toBe(200);
    expect((await request(app).get('/api/v1/chat/files/' + fname + '?t=' + signMedia('other.png') + '&w=480')).status).toBe(401);
  });

  it('没有 thumb 的老消息：?w=480 回退原图，不 404、不裂图', async () => {
    const up = await request(app)
      .post('/api/v1/chat/upload')
      .set('Authorization', 'Bearer ' + token)
      .attach('file', MAIN_BYTES, 'old.png');
    expect(up.status).toBe(200);
    trackUrl(up.body.url);
    const fname = path.basename(up.body.url.split('?')[0]);

    const res = await request(app).get('/api/v1/chat/files/' + fname + '?w=480').set('Authorization', 'Bearer ' + token).buffer(true).parse(binaryParser);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(MAIN_BYTES.length);
  });

  it('thumb 内容与扩展名不符 → 丢弃小图，主图仍然上传成功', async () => {
    const up = await request(app)
      .post('/api/v1/chat/upload')
      .set('Authorization', 'Bearer ' + token)
      .attach('file', MAIN_BYTES, 'photo.png')
      .attach('thumb', Buffer.from('<html>not an image</html>'), 'bad.png');
    expect(up.status).toBe(200);
    trackUrl(up.body.url);
    const fname = path.basename(up.body.url.split('?')[0]);

    const res = await request(app).get('/api/v1/chat/files/' + fname + '?w=480').set('Authorization', 'Bearer ' + token).buffer(true).parse(binaryParser);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(MAIN_BYTES.length);
  });
});
