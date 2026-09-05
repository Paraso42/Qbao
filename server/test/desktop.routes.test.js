'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const request = require('supertest');
const { createApp } = require('../app');
const statsService = require('../src/services/desktopStats');

const SHA512_64 = Buffer.alloc(64, 7).toString('base64'); // base64(64B) = 88 chars

function release(version, extra) {
  return Object.assign({
    version,
    fileName: 'Qbao-Setup-' + version + '.exe',
    sizeBytes: 2048,
    sha256: crypto.createHash('sha256').update('content-' + version).digest('hex'),
    sha512: SHA512_64,
    releaseDate: '2026-09-04T00:00:00.000Z',
    releaseNotes: ['修复若干问题'],
    required: null,
    retracted: null,
  }, extra || {});
}

// 写入 fixture：channels = { stable: [release...], beta: [release...] }
// 将 { channel: [releases] } 包装为清单 schema 的 { channel: { releases: [] } }
function wrapChannels(channels) {
  const out = {};
  for (const [ch, list] of Object.entries(channels)) {
    out[ch] = Array.isArray(list) ? { releases: list } : list;
  }
  return out;
}

function writeFixture(dir, channels) {
  const top = {};
  for (const [ch, releases] of Object.entries(channels)) {
    const chDir = path.join(dir, ch);
    fs.mkdirSync(chDir, { recursive: true });
    for (const r of releases) {
      fs.writeFileSync(path.join(chDir, r.fileName), Buffer.alloc(r.sizeBytes, 7));
      fs.writeFileSync(path.join(chDir, r.fileName + '.blockmap'), Buffer.from('blockmap-' + r.version));
    }
    top[ch] = releases[0] && releases[0].version;
    fs.writeFileSync(path.join(chDir, 'latest.yml'), 'version: ' + (top[ch] || '') + '\n');
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    schemaVersion: 1,
    updatedAt: '2026-09-04T00:00:00.000Z',
    channels: wrapChannels(channels),
  }, null, 2));
}

const stableFixture = [
  release('3.36.0', { required: '3.35.1' }),
  release('3.35.1', { retracted: { reason: '已知恶性 bug', at: '2026-09-05T00:00:00.000Z' } }),
  release('3.35.0'),
  release('3.34.2'),
];
const betaFixture = [
  release('3.35.0-beta.1', { releaseNotes: ['测试功能预览'] }),
];

describe('桌面端统一分发 API v2 (manifest-first)', () => {
  let app;
  let dir;

  // 测试隔离：统计走内存路径，不触 DB（stats 服务运行时读取该变量，无加载顺序问题）
  process.env.QBAO_DESKTOP_STATS = 'off';
  app = createApp();
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qbao-dl2-'));
    process.env.QBAO_DESKTOP_DIR = dir;
    statsService._resetForTests();
  });
  afterEach(() => {
    delete process.env.QBAO_DESKTOP_DIR;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  });

  it('空储藏室：manifest/latest/download 404，/dl 显示未发布，短链仍 302', async () => {
    fs.mkdirSync(dir, { recursive: true });
    expect((await request(app).get('/api/v1/desktop/manifest')).status).toBe(404);
    expect((await request(app).get('/api/v1/desktop/latest')).status).toBe(404);
    expect((await request(app).get('/api/v1/desktop/download')).status).toBe(404);
    const dl = await request(app).get('/dl');
    expect(dl.status).toBe(200);
    expect(dl.text).toContain('暂未发布');
    const s = await request(app).get('/download');
    expect(s.status).toBe(302);
    expect(s.headers.location).toBe('/api/v1/desktop/download');
  });

  it('manifest：最新在前 + 字段完整 + retracted/stopped 标记', async () => {
    writeFixture(dir, { stable: stableFixture, beta: betaFixture });
    const r = await request(app).get('/api/v1/desktop/manifest');
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.channel).toBe('stable');
    expect(r.body.required).toBe('3.35.1');
    expect(r.body.releases.map((x) => x.version)).toEqual(['3.36.0', '3.35.1', '3.35.0', '3.34.2']);
    const top = r.body.releases[0];
    expect(top.required).toBe('3.35.1');
    expect(top.sizeBytes).toBe(2048);
    expect(top.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(top.retracted).toBeNull();
    expect(top.stopped).toBe(false);
    const retr = r.body.releases.find((x) => x.version === '3.35.1');
    expect(retr.retracted.reason).toBe('已知恶性 bug');
    const old = r.body.releases.find((x) => x.version === '3.35.0');
    expect(old.stopped).toBe(true);
    expect(old.retracted).toBeNull();
  });

  it('manifest channel=beta 返回 beta 渠道；未知渠道 400', async () => {
    writeFixture(dir, { stable: stableFixture, beta: betaFixture });
    const b = await request(app).get('/api/v1/desktop/manifest?channel=beta');
    expect(b.status).toBe(200);
    expect(b.body.channel).toBe('beta');
    expect(b.body.releases.map((x) => x.version)).toEqual(['3.35.0-beta.1']);
    expect((await request(app).get('/api/v1/desktop/manifest?channel=foo')).status).toBe(400);
  });

  it('latest 兼容旧字段（version/fileName/sizeBytes/sha256/publishedAt/downloadUrl）', async () => {
    writeFixture(dir, { stable: stableFixture, beta: betaFixture });
    const r = await request(app).get('/api/v1/desktop/latest');
    expect(r.status).toBe(200);
    expect(r.body.version).toBe('3.36.0');
    expect(r.body.fileName).toBe('Qbao-Setup-3.36.0.exe');
    expect(r.body.publishedAt).toBe('2026-09-04T00:00:00.000Z');
    expect(r.body.downloadUrl).toBe('/api/v1/desktop/download');
  });

  it('download 缺省 = 最新稳定版；file= 可精确下载任意留存版本', async () => {
    writeFixture(dir, { stable: stableFixture, beta: betaFixture });
    const d = await request(app).get('/api/v1/desktop/download');
    expect(d.status).toBe(200);
    expect(d.headers['content-disposition']).toContain('Qbao-Setup-3.36.0.exe');
    expect(d.headers['content-type']).toContain('octet-stream');
    expect(d.body.length).toBe(2048);
    const old = await request(app).get('/api/v1/desktop/download?file=Qbao-Setup-3.34.2.exe');
    expect(old.status).toBe(200);
    expect(old.headers['content-disposition']).toContain('Qbao-Setup-3.34.2.exe');
  });

  it('download 非法/未知/穿越文件名一律 404；retracted 版本 410', async () => {
    writeFixture(dir, { stable: stableFixture, beta: betaFixture });
    expect((await request(app).get('/api/v1/desktop/download?file=Qbao-Setup-9.9.9.exe')).status).toBe(404);
    expect((await request(app).get('/api/v1/desktop/download?file=..%2F..%2Fetc%2Fpasswd')).status).toBe(404);
    expect((await request(app).get('/api/v1/desktop/download?file=evil.sh')).status).toBe(404);
    const g = await request(app).get('/api/v1/desktop/download?file=Qbao-Setup-3.35.1.exe');
    expect(g.status).toBe(410);
    expect(g.body.error).toContain('撤回');
  });

  it('update/src: latest.yml text/yaml no-cache；未知渠道 404', async () => {
    writeFixture(dir, { stable: stableFixture, beta: betaFixture });
    const r = await request(app).get('/api/v1/desktop/update/stable/latest.yml');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('text/yaml');
    expect(r.headers['cache-control']).toBe('no-cache');
    expect(r.text).toContain('3.36.0');
    expect((await request(app).get('/api/v1/desktop/update/foo/latest.yml')).status).toBe(404);
  });

  it('update/src: exe 与 blockmap 可下载；未知/穿越文件 404；HEAD 可用', async () => {
    writeFixture(dir, { stable: stableFixture, beta: betaFixture });
    const exe = await request(app).get('/api/v1/desktop/update/stable/Qbao-Setup-3.36.0.exe');
    expect(exe.status).toBe(200);
    expect(exe.headers['content-type']).toContain('octet-stream');
    const bm = await request(app).get('/api/v1/desktop/update/stable/Qbao-Setup-3.36.0.exe.blockmap');
    expect(bm.status).toBe(200);
    expect((await request(app).get('/api/v1/desktop/update/stable/Qbao-Setup-9.9.9.exe')).status).toBe(404);
    expect((await request(app).get('/api/v1/desktop/update/stable/..%2Fmanifest.json')).status).toBe(404);
    expect((await request(app).get('/api/v1/desktop/update/stable/readme.txt')).status).toBe(404);
    const head = await request(app).head('/api/v1/desktop/update/stable/Qbao-Setup-3.36.0.exe');
    expect(head.status).toBe(200);
  });

  it('下载统计：完整 GET 记 1 次，Range 206 与 HEAD 不计数', async () => {
    writeFixture(dir, { stable: stableFixture, beta: betaFixture });
    await request(app).get('/api/v1/desktop/download?file=Qbao-Setup-3.36.0.exe');
    await request(app).get('/api/v1/desktop/download').set('Range', 'bytes=0-15');
    await request(app).head('/api/v1/desktop/download');
    const s = await request(app).get('/api/v1/desktop/stats');
    expect(s.status).toBe(200);
    expect(s.body.ok).toBe(true);
    const row = s.body.perVersion.find((x) => x.version === '3.36.0');
    expect(row.downloads).toBe(1);
    expect(Array.isArray(s.body.last30d)).toBe(true);
  });

  it('落地页 /dl：稳定版视图 + 历史版本 + beta 视图', async () => {
    writeFixture(dir, { stable: stableFixture, beta: betaFixture });
    const p = await request(app).get('/dl');
    expect(p.status).toBe(200);
    expect(p.headers['x-content-type-options']).toBe('nosniff');
    expect(p.text).toContain('Qbao 桌面版下载');
    expect(p.text).toContain('3.36.0');
    expect(p.text).toContain('已停止服务');
    expect(p.text).toContain('已撤回');
    expect(p.text).toContain('历史版本');
    expect(p.text).toContain('Get-FileHash');
    const b = await request(app).get('/dl?channel=beta');
    expect(b.text).toContain('3.35.0-beta.1');
    expect(b.text).toContain('测试版');
  });
});