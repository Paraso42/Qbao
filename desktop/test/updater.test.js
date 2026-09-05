'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const util = require('../updater-util');

test('buildFeedUrl：apiBase + 渠道拼接；非法/空 → null', () => {
  assert.strictEqual(util.buildFeedUrl('https://qbao.example.com/api/v1', 'stable'), 'https://qbao.example.com/api/v1/desktop/update/stable');
  assert.strictEqual(util.buildFeedUrl('https://qbao.example.com/api/v1/', 'beta'), 'https://qbao.example.com/api/v1/desktop/update/beta');
  assert.strictEqual(util.buildFeedUrl('https://qbao.example.com/api/v1', 'foo'), 'https://qbao.example.com/api/v1/desktop/update/stable');
  assert.strictEqual(util.buildFeedUrl('', 'stable'), null);
  assert.strictEqual(util.buildFeedUrl('not-a-url', 'stable'), null);
  assert.strictEqual(util.buildFeedUrl(null, 'stable'), null);
});

test('shouldForceUpdate：仅当低于 required 时才强制', () => {
  assert.strictEqual(util.shouldForceUpdate('3.34.2', '3.35.0'), true);
  assert.strictEqual(util.shouldForceUpdate('3.35.0', '3.35.0'), false);
  assert.strictEqual(util.shouldForceUpdate('3.36.0', '3.35.0'), false);
  assert.strictEqual(util.shouldForceUpdate('3.35.0', null), false);
  assert.strictEqual(util.shouldForceUpdate('3.35.0', ''), false);
  assert.strictEqual(util.shouldForceUpdate('3.35.0-beta.1', '3.35.0'), true);
});

test('isInstalledVersionRetracted：列表不含当前版本才算被撤回', () => {
  const releases = [
    { version: '3.36.0' }, { version: '3.35.0' },
  ];
  assert.strictEqual(util.isInstalledVersionRetracted('3.35.0', releases), false);
  assert.strictEqual(util.isInstalledVersionRetracted('3.35.1', releases), true);
  assert.strictEqual(util.isInstalledVersionRetracted('3.34.2', releases), true);
  assert.strictEqual(util.isInstalledVersionRetracted('3.35.0', []), false);
  assert.strictEqual(util.isInstalledVersionRetracted('3.35.0', null), false);
});

test('validateDownloadArgs：白名单 + 版本一致 + sha256 格式', () => {
  const ok = util.validateDownloadArgs({ fileName: 'Qbao-Setup-3.35.0.exe', version: '3.35.0', sha256: 'a'.repeat(64) });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.version, '3.35.0');

  assert.strictEqual(util.validateDownloadArgs({ fileName: '../../evil.exe', version: '3.35.0', sha256: 'a'.repeat(64) }).ok, false);
  assert.strictEqual(util.validateDownloadArgs({ fileName: 'readme.md', version: '3.35.0', sha256: 'a'.repeat(64) }).ok, false);
  assert.strictEqual(util.validateDownloadArgs({ fileName: 'Qbao-Setup-3.35.0.exe', version: '3.35.1', sha256: 'a'.repeat(64) }).ok, false);
  assert.strictEqual(util.validateDownloadArgs({ fileName: 'Qbao-Setup-3.35.0.exe', version: '3.35.0', sha256: 'not-hex' }).ok, false);
  assert.strictEqual(util.validateDownloadArgs(null).ok, false);
  assert.strictEqual(util.validateDownloadArgs({}).ok, false);
  // prerelease 文件名也允许（beta 渠道历史版本）
  const beta = util.validateDownloadArgs({ fileName: 'Qbao-Setup-3.35.0-beta.1.exe', version: '3.35.0-beta.1', sha256: 'b'.repeat(64) });
  assert.strictEqual(beta.ok, true);
  assert.strictEqual(beta.version, '3.35.0-beta.1');
});

test('compareVersions 基础排序（updater 内部使用）', () => {
  assert.ok(util.compareVersions('3.35.0', '3.34.2') > 0);
  assert.ok(util.compareVersions('3.35.0', '3.35.0') === 0);
  assert.ok(util.compareVersions('3.35.0-beta.1', '3.35.0') < 0);
});
