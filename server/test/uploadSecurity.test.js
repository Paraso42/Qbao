'use strict';

// T2 整改测试：上传通道安全
// - chat 上传扩展名白名单（html/svg/exe 拒绝）
// - chat 上传 magic bytes 校验（改后缀的 HTML 伪装 png 拒绝）
// - issue 上传白名单（svg 拒绝）
// - chat 下载非图片强制 attachment + octet-stream
// - /uploads 静态映射已移除（pool 文件不再可匿名访问）

const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { installFakePool } = require('./helpers');
const { createApp } = require('../app');
const { signToken } = require('../src/auth');

const CHAT_UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'chat');
const ISSUE_UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'issues');

describe('上传通道安全（T2）', () => {
  const app = createApp();
  let token;
  const createdFiles = [];

  function track(filePath) {
    if (filePath) createdFiles.push(filePath);
  }

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-0123456789';
    token = signToken(1, 'user');
    installFakePool([]);
  });

  afterEach(() => {
    // 清理测试期间产生的上传文件
    for (const f of createdFiles.splice(0)) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {}
    }
  });

  it('chat 上传 .html → 422 拒绝', async () => {
    const res = await request(app)
      .post('/api/v1/chat/upload')
      .set('Authorization', 'Bearer ' + token)
      .attach('file', Buffer.from('<script>alert(1)</script>'), 'evil.html');
    expect(res.status).toBe(422);
    expect(res.body.error).toContain('不支持的文件类型');
  });

  it('chat 上传 .exe → 422 拒绝', async () => {
    const res = await request(app)
      .post('/api/v1/chat/upload')
      .set('Authorization', 'Bearer ' + token)
      .attach('file', Buffer.from('MZ fake exe'), 'evil.exe');
    expect(res.status).toBe(422);
  });

  it('chat 上传改后缀的 HTML（伪装 .png）→ 422（magic bytes 拦截）', async () => {
    const res = await request(app)
      .post('/api/v1/chat/upload')
      .set('Authorization', 'Bearer ' + token)
      .attach('file', Buffer.from('<html><script>alert(1)</script></html>'), 'fake.png');
    expect(res.status).toBe(422);
    expect(res.body.error).toContain('文件内容与扩展名不符');
  });

  it('chat 上传真实 PNG → 200 且响应含业务端点 URL', async () => {
    // 1x1 PNG magic bytes
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
    ]);
    const res = await request(app)
      .post('/api/v1/chat/upload')
      .set('Authorization', 'Bearer ' + token)
      .attach('file', png, 'ok.png');
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^\/api\/v1\/chat\/files\/chat_/);
    track(path.join(CHAT_UPLOAD_DIR, path.basename(res.body.url)));
  });

  it('issue 上传 .svg → 422 拒绝', async () => {
    const res = await request(app)
      .post('/api/v1/issues/upload')
      .set('Authorization', 'Bearer ' + token)
      .attach('image', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'evil.svg');
    expect(res.status).toBe(422);
    expect(res.body.error).toContain('仅支持');
  });

  it('issue 上传伪装 .png 的 HTML → 422（magic bytes 拦截）', async () => {
    const res = await request(app)
      .post('/api/v1/issues/upload')
      .set('Authorization', 'Bearer ' + token)
      .attach('image', Buffer.from('<html>fake</html>'), 'fake.png');
    expect(res.status).toBe(422);
  });

  it('issue 上传真实 PNG → 200', async () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
    ]);
    const res = await request(app)
      .post('/api/v1/issues/upload')
      .set('Authorization', 'Bearer ' + token)
      .attach('image', png, 'ok.png');
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^\/api\/v1\/issues\/images\/issue_/);
    track(path.join(ISSUE_UPLOAD_DIR, path.basename(res.body.url)));
  });

  it('chat 下载 .txt 文件 → Content-Disposition: attachment + octet-stream', async () => {
    const fname = 'chat_sec_test_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.txt';
    const abs = path.join(CHAT_UPLOAD_DIR, fname);
    fs.writeFileSync(abs, 'hello');
    track(abs);
    const res = await request(app).get('/api/v1/chat/files/' + fname);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-type']).toContain('octet-stream');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('chat 下载 .png → 允许 inline（无 attachment）', async () => {
    const png = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
    ]);
    const fname = 'chat_sec_test_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.png';
    const abs = path.join(CHAT_UPLOAD_DIR, fname);
    fs.writeFileSync(abs, png);
    track(abs);
    const res = await request(app).get('/api/v1/chat/files/' + fname);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition'] || '').not.toContain('attachment');
  });

  it('/uploads 静态映射已移除：pool 文件不再可直接访问', async () => {
    // 在 uploads/pool 放一个探测文件，确认无静态路由可访问
    const POOL_DIR = path.join(__dirname, '..', '..', 'uploads', 'pool');
    if (!fs.existsSync(POOL_DIR)) fs.mkdirSync(POOL_DIR, { recursive: true });
    const fname = 'probe_' + Date.now() + '.txt';
    const abs = path.join(POOL_DIR, fname);
    fs.writeFileSync(abs, 'probe');
    track(abs);
    const res = await request(app).get('/uploads/pool/' + fname);
    expect(res.status).toBe(404);
  });

  it('/avatars 静态服务保留且带 nosniff', async () => {
    const AVATAR_DIR = path.join(__dirname, '..', '..', 'uploads', 'avatars');
    if (!fs.existsSync(AVATAR_DIR)) fs.mkdirSync(AVATAR_DIR, { recursive: true });
    const fname = 'avatar_probe_' + Date.now() + '.jpg';
    const abs = path.join(AVATAR_DIR, fname);
    fs.writeFileSync(abs, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]));
    track(abs);
    const res = await request(app).get('/avatars/' + fname);
    expect(res.status).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
