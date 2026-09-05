'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const dm = require('../src/services/desktopManifest');

const SHA512_64 = Buffer.alloc(64, 7).toString('base64');

function release(version, extra) {
  return Object.assign({
    version,
    fileName: 'Qbao-Setup-' + version + '.exe',
    sizeBytes: 2048,
    sha256: crypto.createHash('sha256').update('c-' + version).digest('hex'),
    sha512: SHA512_64,
    releaseDate: '2026-09-04T00:00:00.000Z',
    releaseNotes: [],
    required: null,
    retracted: null,
  }, extra || {});
}

describe('desktopManifest 服务（清单校验与解析）', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qbao-mm-'));
    process.env.QBAO_DESKTOP_DIR = dir;
  });
  afterEach(() => {
    delete process.env.QBAO_DESKTOP_DIR;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  });

  // 将 { channel: [releases] } 包装为清单 schema
  function wrapChannels(channels) {
    const out = {};
    for (const [ch, list] of Object.entries(channels)) {
      out[ch] = Array.isArray(list) ? { releases: list } : list;
    }
    return out;
  }

  function install(channels) {
    for (const [ch, releases] of Object.entries(channels)) {
      const chDir = path.join(dir, ch);
      fs.mkdirSync(chDir, { recursive: true });
      for (const r of releases) {
        fs.writeFileSync(path.join(chDir, r.fileName), Buffer.alloc(8, 1));
      }
      fs.writeFileSync(path.join(chDir, 'latest.yml'), 'version: ' + (releases[0] ? releases[0].version : '') + '\n');
    }
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ schemaVersion: 1, updatedAt: 'x', channels: wrapChannels(channels) }));
  }

  it('semver 比较：普通版本、prerelease 排序、数字标识符规则', () => {
    expect(dm.compareVersions('3.35.0', '3.34.2')).toBeGreaterThan(0);
    expect(dm.compareVersions('3.35.0', '3.35.0-beta.1')).toBeGreaterThan(0);
    expect(dm.compareVersions('3.35.0-beta.2', '3.35.0-beta.1')).toBeGreaterThan(0);
    expect(dm.compareVersions('3.35.0-beta.1', '3.35.0-alpha')).toBeGreaterThan(0); // 数字 < 字母
    expect(dm.compareVersions('3.35.0-alpha.1', '3.35.0-alpha')).toBeGreaterThan(0);
    expect(dm.compareVersions('3.35.0', '3.35.0')).toBe(0);
    expect(dm.isPrerelease('3.35.0-beta.1')).toBe(true);
    expect(dm.isPrerelease('3.35.0')).toBe(false);
  });

  it('合法清单加载并统一最新在前；topOf 跳过 retracted', () => {
    install({ stable: [release('3.34.2'), release('3.36.0'), release('3.35.1', { retracted: { reason: 'bug' } })], beta: [release('3.35.0-beta.1')] });
    const m = dm.getManifest();
    expect(m.channels.stable.releases.map((r) => r.version)).toEqual(['3.36.0', '3.35.1', '3.34.2']);
    expect(dm.topOf('stable').version).toBe('3.36.0');
    expect(dm.latestRequired('stable')).toBeNull();
  });

  it('required 作用于最新未撤回版本；isStopped 判定', () => {
    install({ stable: [release('3.36.0', { required: '3.35.0' }), release('3.35.0'), release('3.34.2')] });
    expect(dm.latestRequired('stable')).toBe('3.35.0');
    expect(dm.isStopped('stable', release('3.34.2'))).toBe(true);
    expect(dm.isStopped('stable', { version: '3.35.0' })).toBe(false);
    expect(dm.isStopped('stable', { version: '3.36.0' })).toBe(false);
    expect(dm.releasesOf('foo')).toBeNull();
  });

  it('纪律拒绝：beta 携带 required / retracted、stable 携带 prerelease', () => {
    install({ beta: [release('3.35.0-beta.1', { required: '3.34.0' })] });
    expect(() => dm.getManifest()).toThrow(/beta 渠道禁止 required/);
    delete process.env.QBAO_DESKTOP_DIR; // 换 fixture
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'qbao-mm2-'));
    process.env.QBAO_DESKTOP_DIR = dir2;
    try {
      fs.mkdirSync(path.join(dir2, 'beta'), { recursive: true });
      fs.writeFileSync(path.join(dir2, 'beta', 'Qbao-Setup-3.35.0-beta.1.exe'), Buffer.alloc(8));
      fs.writeFileSync(path.join(dir2, 'beta', 'latest.yml'), 'version: 3.35.0-beta.1\n');
      fs.writeFileSync(path.join(dir2, 'manifest.json'), JSON.stringify({
        schemaVersion: 1, updatedAt: 'x',
        channels: { beta: { releases: [release('3.35.0-beta.1', { retracted: { reason: 'x' } })] } },
      }));
      expect(() => dm.getManifest()).toThrow(/beta 渠道禁止 retracted/);
    } finally {
      delete process.env.QBAO_DESKTOP_DIR;
      try { fs.rmSync(dir2, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    }
    process.env.QBAO_DESKTOP_DIR = dir;
    // 原 fixture（beta 携带 required）依旧被拒绝 —— 纪律恒定
    expect(() => dm.getManifest()).toThrow(/beta 渠道禁止 required/);
  });

  it('纪律拒绝：stable 渠道 prerelease 版本', () => {
    install({ stable: [release('3.35.0-beta.1')] });
    expect(() => dm.getManifest()).toThrow(/stable 渠道禁止 prerelease/);
  });

  it('清单引用文件缺失 / 重复版本 / 非空渠道缺 latest.yml → 拒绝加载', () => {
    fs.mkdirSync(path.join(dir, 'stable'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
      schemaVersion: 1, updatedAt: 'x',
      channels: { stable: { releases: [release('3.35.0')] } }, // stable 目录无 exe
    }));
    expect(() => dm.getManifest()).toThrow(/清单文件缺失/);

    install({ stable: [release('3.35.0'), release('3.35.0')] });
    expect(() => dm.getManifest()).toThrow(/重复版本/);

    fs.mkdirSync(path.join(dir, 'beta'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'beta', 'Qbao-Setup-3.35.0-beta.1.exe'), Buffer.alloc(8));
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
      schemaVersion: 1, updatedAt: 'x',
      channels: { beta: { releases: [release('3.35.0-beta.1')] } }, // beta 无 latest.yml
    }));
    expect(() => dm.getManifest()).toThrow(/缺少 latest.yml/);
  });

  it('manifest.json 损坏时回退 manifest.json.bak', () => {
    install({ stable: [release('3.35.0')] });
    fs.copyFileSync(path.join(dir, 'manifest.json'), path.join(dir, 'manifest.json.bak'));
    fs.writeFileSync(path.join(dir, 'manifest.json'), '{ broken json');
    const m = dm.getManifest();
    expect(m.channels.stable.releases[0].version).toBe('3.35.0');
  });

  it('mtime 缓存：文件变更后重新加载', () => {
    install({ stable: [release('3.35.0')] });
    expect(dm.getManifest().channels.stable.releases[0].version).toBe('3.35.0');
    // 新版本文件就位后再切换清单
    fs.writeFileSync(path.join(dir, 'stable', 'Qbao-Setup-3.36.0.exe'), Buffer.alloc(8, 1));
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
      schemaVersion: 1, updatedAt: 'x',
      channels: { stable: { releases: [release('3.36.0')] } },
    }));
    // 强制 mtime 递增（部分文件系统秒级粒度）
    const now = new Date();
    fs.utimesSync(path.join(dir, 'manifest.json'), now, new Date(now.getTime() + 2000));
    expect(dm.getManifest().channels.stable.releases[0].version).toBe('3.36.0');
  });

  it('findReleaseByFile 全局查找（stable 优先）', () => {
    install({ stable: [release('3.35.0')], beta: [release('3.35.0-beta.1')] });
    const hit = dm.findReleaseByFile('Qbao-Setup-3.35.0-beta.1.exe');
    expect(hit.channel).toBe('beta');
    expect(hit.release.version).toBe('3.35.0-beta.1');
    expect(dm.findReleaseByFile('Qbao-Setup-9.9.9.exe')).toBeNull();
  });
});