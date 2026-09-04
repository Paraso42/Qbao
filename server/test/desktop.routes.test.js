'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const request = require('supertest');
const { createApp } = require('../app');

// 桌面端国内镜像分发（v3.34.1）：latest 元信息 + 附件下载
describe('桌面端镜像分发 API', () => {
  const app = createApp();
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qbao-dl-'));
    process.env.QBAO_DESKTOP_DIR = dir;
  });
  afterEach(() => {
    delete process.env.QBAO_DESKTOP_DIR;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  });

  function putFile(name, content) {
    fs.writeFileSync(path.join(dir, name), content);
  }

  it('无安装包时 latest/download 均 404', async () => {
    const r1 = await request(app).get('/api/v1/desktop/latest');
    expect(r1.status).toBe(404);
    const r2 = await request(app).get('/api/v1/desktop/download');
    expect(r2.status).toBe(404);
  });

  it('latest 返回最新版元信息（meta.json 优先，含 sha256/大小/日期）', async () => {
    putFile('Qbao-Setup-3.33.1.exe', 'old');
    putFile('Qbao-Setup-3.34.0.exe', Buffer.alloc(2048, 7));
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
      version: '3.34.0',
      fileName: 'Qbao-Setup-3.34.0.exe',
      sha256: 'aa' + '11'.repeat(31),
      size: 2048,
      publishedAt: '2026-09-04T15:01:20.000Z',
    }));

    const r = await request(app).get('/api/v1/desktop/latest');
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.version).toBe('3.34.0');
    expect(r.body.fileName).toBe('Qbao-Setup-3.34.0.exe');
    expect(r.body.sizeBytes).toBe(2048);
    expect(r.body.sha256).toBe('aa' + '11'.repeat(31));
    expect(r.body.publishedAt).toContain('2026-09-04');
    expect(r.body.downloadUrl).toBe('/api/v1/desktop/download');
  });

  it('无 meta.json 时 sha256 自动计算兜底', async () => {
    const content = Buffer.from('fake-installer-bytes-桌面端测试');
    putFile('Qbao-Setup-3.34.0.exe', content);
    const expected = crypto.createHash('sha256').update(content).digest('hex');

    const r = await request(app).get('/api/v1/desktop/latest');
    expect(r.status).toBe(200);
    expect(r.body.sha256).toBe(expected);
    expect(r.body.sizeBytes).toBe(content.length);
  });

  it('download 以附件流返回最新安装包内容', async () => {
    const content = Buffer.alloc(4096);
    content.write('MZ-stub');
    putFile('Qbao-Setup-3.34.0.exe', content);

    const r = await request(app).get('/api/v1/desktop/download');
    expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toContain('Qbao-Setup-3.34.0.exe');
    expect(Buffer.isBuffer(r.body) ? r.body.length : r.text.length).toBe(4096);
  });
});
