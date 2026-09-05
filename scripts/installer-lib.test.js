'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('node:child_process');
const lib = require('./installer-lib');

function tmpdir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function sha512b64(buf) {
  return crypto.createHash('sha512').update(buf).digest('base64');
}

function writeElectronBuilderYaml(file, version, exeName, buf) {
  const b64 = sha512b64(buf);
  const yaml = [
    'version: ' + version,
    'files:',
    '  - url: ' + exeName,
    '    sha512: ' + b64,
    '    size: ' + buf.length,
    'path: ' + exeName,
    'sha512: ' + b64,
    "releaseDate: '2026-09-05T08:00:00.000Z'",
    '',
  ].join('\n');
  fs.writeFileSync(file, yaml, 'utf8');
}

test('semver 比较（含 prerelease）', () => {
  assert.ok(lib.compareVersions('3.35.0', '3.34.2') > 0);
  assert.ok(lib.compareVersions('3.35.0', '3.35.0-beta.1') > 0);
  assert.ok(lib.compareVersions('3.35.0-beta.2', '3.35.0-beta.1') > 0);
  assert.ok(lib.compareVersions('3.35.0-beta.1', '3.35.0-alpha') > 0);
  assert.ok(lib.compareVersions('3.35.0-alpha.1', '3.35.0-alpha') > 0);
  assert.strictEqual(lib.compareVersions('3.35.0', '3.35.0'), 0);
  assert.ok(lib.isPrerelease('3.35.0-beta.1'));
  assert.ok(!lib.isPrerelease('3.35.0'));
});

test('parseLatestYaml 解析 electron-builder 产物', () => {
  const buf = Buffer.from('x'.repeat(100));
  const dir = tmpdir('qbao-yaml-');
  const file = path.join(dir, 'latest.yml');
  writeElectronBuilderYaml(file, '3.35.0', 'Qbao-Setup-3.35.0.exe', buf);
  const y = lib.parseLatestYaml(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(y.version, '3.35.0');
  assert.strictEqual(y.files.length, 1);
  assert.strictEqual(y.files[0].url, 'Qbao-Setup-3.35.0.exe');
  assert.strictEqual(y.files[0].sha512, sha512b64(buf));
  assert.strictEqual(String(y.files[0].size), String(buf.length));
  assert.strictEqual(y.topSha512, sha512b64(buf));
  assert.strictEqual(y.releaseDate, '2026-09-05T08:00:00.000Z');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('verifyLatestYaml：一致通过；sha512 不一致拒绝', async () => {
  const dir = tmpdir('qbao-verify-');
  const exe = path.join(dir, 'Qbao-Setup-3.35.0.exe');
  const buf = Buffer.from('installer-bytes');
  fs.writeFileSync(exe, buf);
  const yaml = path.join(dir, 'latest.yml');
  writeElectronBuilderYaml(yaml, '3.35.0', 'Qbao-Setup-3.35.0.exe', buf);
  const ok = await lib.verifyLatestYaml(fs.readFileSync(yaml, 'utf8'), exe, '3.35.0');
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.sha512, sha512b64(buf));

  // 篡改 exe → 哈希不一致
  fs.writeFileSync(exe, Buffer.from('tampered-bytes!'));
  const bad = await lib.verifyLatestYaml(fs.readFileSync(yaml, 'utf8'), exe, '3.35.0');
  assert.strictEqual(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.includes('sha512')));

  // 版本不一致
  fs.writeFileSync(exe, buf);
  const wrongVer = await lib.verifyLatestYaml(fs.readFileSync(yaml, 'utf8'), exe, '3.35.1');
  assert.strictEqual(wrongVer.ok, false);
  assert.ok(wrongVer.errors.some((e) => e.includes('version')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('saveManifestAtomic：原子写 + 滚动备份 + 无 .tmp 残留', () => {
  const dir = tmpdir('qbao-atomic-');
  const m1 = { schemaVersion: 1, updatedAt: null, channels: { stable: { releases: [] }, beta: { releases: [] } } };
  lib.saveManifestAtomic(dir, m1);
  assert.ok(fs.existsSync(path.join(dir, 'manifest.json')));
  const m2 = JSON.parse(JSON.stringify(m1));
  m2.channels.stable.releases.push({ version: '3.35.0', fileName: 'Qbao-Setup-3.35.0.exe' });
  lib.saveManifestAtomic(dir, m2);
  const bak = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json.bak'), 'utf8'));
  assert.strictEqual(bak.channels.stable.releases.length, 0);
  assert.ok(!fs.existsSync(path.join(dir, 'manifest.json.tmp')));
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).channels.stable.releases.length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('pruneChannel：默认保 3；可用版本不足时延伸保底 2', () => {
  const m = { schemaVersion: 1, updatedAt: null, channels: { stable: { releases: [] } } };
  function rel(v, extra) {
    return Object.assign({ version: v, fileName: 'Qbao-Setup-' + v + '.exe' }, extra || {});
  }
  // 用例 1：可用版本足够 → 严格保留最新 3 个
  m.channels.stable.releases = lib.sortReleasesDesc([
    rel('3.36.0'), rel('3.35.1', { retracted: { reason: 'bug' } }), rel('3.35.0'), rel('3.34.2'), rel('3.34.1'),
  ]);
  let removed = lib.pruneChannel(m, 'stable', 3, 2);
  assert.deepStrictEqual(m.channels.stable.releases.map((r) => r.version).sort(), ['3.35.0', '3.35.1', '3.36.0']);
  assert.deepStrictEqual(removed, [
    'Qbao-Setup-3.34.2.exe', 'Qbao-Setup-3.34.2.exe.blockmap',
    'Qbao-Setup-3.34.1.exe', 'Qbao-Setup-3.34.1.exe.blockmap',
  ]);

  // 用例 2：前 2 个中仅 1 个可用 → 延伸保留直到可用 >= 2
  m.channels.stable.releases = lib.sortReleasesDesc([
    rel('3.36.0'), rel('3.35.1', { retracted: { reason: 'bug' } }), rel('3.35.0', { retracted: { reason: 'bug2' } }), rel('3.34.2'), rel('3.34.1'),
  ]);
  removed = lib.pruneChannel(m, 'stable', 2, 2);
  assert.deepStrictEqual(m.channels.stable.releases.map((r) => r.version).sort(), ['3.34.2', '3.35.0', '3.35.1', '3.36.0']);
  assert.deepStrictEqual(removed, ['Qbao-Setup-3.34.1.exe', 'Qbao-Setup-3.34.1.exe.blockmap']);
});

test('CLI 端到端：add → promote → retract → verify → ls', () => {
  const root = tmpdir('qbao-cli-');
  const staged = tmpdir('qbao-staged-');
  const buf = Buffer.from('MZ-fake-installer-内容');
  const exeName = 'Qbao-Setup-3.35.0.exe';
  const exe = path.join(staged, exeName);
  fs.writeFileSync(exe, buf);
  fs.writeFileSync(path.join(staged, exeName + '.blockmap'), Buffer.from('blockmap-bytes'));
  writeElectronBuilderYaml(path.join(staged, 'latest.yml'), '3.35.0', exeName, buf);
  const cli = path.join(__dirname, 'publish-installer.js');
  const run = (args) => execFileSync(process.execPath, [cli].concat(args), { encoding: 'utf8' });

  // add
  const addOut = run(['add', '--root', root, '--dir', staged, '--channel', 'stable', '--notes', '工程化发布测试']);
  assert.ok(addOut.includes('add 完成'));
  assert.ok(fs.existsSync(path.join(root, 'stable', exeName)));
  assert.ok(fs.existsSync(path.join(root, 'stable', 'latest.yml')));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.strictEqual(manifest.channels.stable.releases[0].version, '3.35.0');
  assert.strictEqual(manifest.channels.stable.releases[0].releaseNotes[0], '工程化发布测试');

  // 重复 add 拒绝（无 --force）
  assert.throws(() => run(['add', '--root', root, '--dir', staged, '--channel', 'stable']), /已存在版本/);

  // stable 拒绝 prerelease
  const staged2 = tmpdir('qbao-staged2-');
  const exe2 = path.join(staged2, 'Qbao-Setup-3.35.0-beta.1.exe');
  const buf2 = Buffer.from('beta-installer');
  fs.writeFileSync(exe2, buf2);
  writeElectronBuilderYaml(path.join(staged2, 'latest.yml'), '3.35.0-beta.1', 'Qbao-Setup-3.35.0-beta.1.exe', buf2);
  assert.throws(() => run(['add', '--root', root, '--dir', staged2, '--channel', 'stable']), /stable 渠道禁止 prerelease/);

  // beta 渠道允许 prerelease
  const betaOut = run(['add', '--root', root, '--dir', staged2, '--channel', 'beta']);
  assert.ok(betaOut.includes('beta → 3.35.0-beta.1'));

  // promote（含 beta 拒绝 + 版本门槛校验）
  assert.throws(() => run(['promote', '--root', root, '--channel', 'beta', '--version', '3.35.0-beta.1', '--required', '3.34.0']), /仅允许 stable/);
  const promoteOut = run(['promote', '--root', root, '--channel', 'stable', '--version', '3.35.0', '--required', '3.34.0']);
  assert.ok(promoteOut.includes('要求 >= 3.34.0'));
  let m2 = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.strictEqual(m2.channels.stable.releases[0].required, '3.34.0');

  // retract（自动清除 required）
  const retractOut = run(['retract', '--root', root, '--channel', 'stable', '--version', '3.35.0', '--reason', '端到端测试撤回']);
  assert.ok(retractOut.includes('已撤回'));
  m2 = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.ok(m2.channels.stable.releases[0].retracted);
  assert.strictEqual(m2.channels.stable.releases[0].required, null);
  assert.ok(fs.existsSync(path.join(root, 'stable', exeName))); // 文件保留

  // verify
  const vOut = run(['verify', '--file', exe, '--sha256', crypto.createHash('sha256').update(buf).digest('hex')]);
  assert.ok(vOut.includes('一致'));

  // ls
  const lsOut = run(['ls', '--root', root]);
  assert.ok(lsOut.includes('[stable]'));
  assert.ok(lsOut.includes('3.35.0'));
  assert.ok(lsOut.includes('[beta]'));

  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(staged, { recursive: true, force: true });
  fs.rmSync(staged2, { recursive: true, force: true });
});