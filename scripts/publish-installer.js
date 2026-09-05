'use strict';

// Qbao 桌面端安装包发布工具（v3.35 · 零第三方依赖）
// 用法：
//   node scripts/publish-installer.js add --dir <暂存目录> --channel stable|beta [--notes "一行"] [--prune] [--keep N] [--min-keep N] [--force]
//   node scripts/publish-installer.js promote --channel stable --version X --required Y
//   node scripts/publish-installer.js retract --channel stable --version X --reason "原因"
//   node scripts/publish-installer.js verify --file <exe> [--sha256 <期望值>]
//   node scripts/publish-installer.js ls [--channel stable|beta]
// 通用：--root <下载根目录>（默认 ./downloads；生产机上与 QBAO_DESKTOP_DIR 保持一致）
// 说明：add 的暂存目录应包含 electron-builder 的三件套：
//       Qbao-Setup-<v>.exe、Qbao-Setup-<v>.exe.blockmap、latest.yml（官方构建产物）。

const fs = require('fs');
const path = require('path');
const lib = require('./installer-lib');

// —— 参数解析 ——
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out[key] = next;
        i += 1;
      } else {
        out[key] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function fail(msg) {
  console.error('[publish-installer] 错误: ' + msg);
  process.exit(1);
}

function breakdown(releases) {
  return releases.map((r) => {
    const marks = [];
    if (r.retracted) marks.push('已撤回');
    if (r.required) marks.push('强制>=' + r.required);
    marks.push(r.version);
    return '  ' + (marks.filter((x) => x !== r.version).join(' ') ? '[' + marks.filter((x) => x !== r.version).join('] [') + '] ' : '') + r.version + '  ' + r.fileName;
  }).join('\n');
}

function resolveRoot(root) {
  return path.resolve(root || path.join(process.cwd(), 'downloads'));
}

// ================= add =================
async function cmdAdd(opts) {
  const root = resolveRoot(opts.root);
  const channel = String(opts.channel || 'stable');
  if (!lib.CHANNELS.includes(channel)) fail('未知渠道: ' + channel + '（可选 stable|beta）');
  const dir = path.resolve(String(opts.dir || ''));
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) fail('--dir 暂存目录不存在: ' + dir);

  // 1) 找安装包 / blockmap / latest.yml
  let exeName = null;
  let exeAbs = null;
  let bmAbs = null;
  for (const n of fs.readdirSync(dir)) {
    const abs = path.join(dir, n);
    if (!fs.statSync(abs).isFile()) continue;
    if (lib.FILE_RE.test(n) && n.toLowerCase().endsWith('.exe')) {
      if (exeAbs) fail('暂存目录存在多个安装包，请仅放置一个');
      exeAbs = abs;
      exeName = n;
    } else if (n.endsWith('.exe.blockmap')) {
      bmAbs = abs;
    }
  }
  if (!exeAbs) fail('暂存目录缺少 Qbao-Setup-<version>.exe');
  const lmAbs = path.join(dir, 'latest.yml');
  if (!fs.existsSync(lmAbs)) fail('暂存目录缺少 latest.yml（请使用 electron-builder 官方产物）');
  const version = lib.FILE_RE.exec(exeName)[1];
  if (!lib.VERSION_RE.test(version)) fail('非法版本号: ' + version);

  // 2) 渠道纪律
  if (channel === 'stable' && lib.isPrerelease(version)) fail('stable 渠道禁止 prerelease 版本: ' + version + '（测试版请发布到 beta 渠道，或去掉 -beta 后缀经验收后发布）');
  if (channel === 'beta' && !lib.isPrerelease(version)) {
    console.warn('[publish-installer] 提醒: beta 渠道发布正式版号 ' + version + '（候选验证用途）。正式发布请走 stable。');
  }

  // 3) latest.yml 与安装包交叉校验（sha512/size/version 逐字节）
  const check = await lib.verifyLatestYaml(fs.readFileSync(lmAbs, 'utf8'), exeAbs, version);
  if (!check.ok) {
    for (const e of check.errors) console.error('  ✗ ' + e);
    fail('latest.yml 与安装包不一致，拒绝入库');
  }
  if (bmAbs && path.basename(bmAbs) !== exeName + '.blockmap') fail('blockmap 文件名与安装包不匹配: ' + path.basename(bmAbs));

  // 4) 加载清单 + 版本递增校验
  const manifest = lib.loadManifest(root);
  validateManifestOrDie(manifest);
  const entry = lib.channelOf(manifest, channel);
  const existing = entry.releases.find((r) => r.version === version);
  if (existing && !opts.force) fail('渠道 ' + channel + ' 已存在版本 ' + version + '（如需覆盖请加 --force）');
  const highest = entry.releases.length ? entry.releases.reduce((a, b) => (lib.compareVersions(b.version, a.version) > 0 ? b : a)).version : null;
  if (highest && !existing && lib.compareVersions(version, highest) <= 0 && !opts.force) {
    fail('版本 ' + version + ' 不高于渠道现有最高版本 ' + highest + '（如需降级/重发请加 --force）');
  }

  // 5) 复制三件套入库
  const chDir = path.join(root, channel);
  fs.mkdirSync(chDir, { recursive: true });
  fs.copyFileSync(exeAbs, path.join(chDir, exeName));
  if (bmAbs) fs.copyFileSync(bmAbs, path.join(chDir, path.basename(bmAbs)));
  const bmYaml = path.join(chDir, 'latest.yml');
  if (fs.existsSync(bmYaml) && !opts.force) console.warn('[publish-installer] 提醒: 覆盖渠道 latest.yml（旧内容属于 ' + readYamlVersion(bmYaml) + '）');
  fs.copyFileSync(lmAbs, bmYaml);

  // 6) 生成 release 条目并落清单（原子 + .bak）
  const notes = [];
  if (opts.notes) notes.push(String(opts.notes));
  const release = {
    version,
    fileName: exeName,
    sizeBytes: check.size,
    sha256: await lib.sha256File(exeAbs),
    sha512: check.sha512,
    releaseDate: existing && existing.releaseDate ? existing.releaseDate : new Date().toISOString(),
    releaseNotes: notes,
    required: null,
    retracted: null,
  };
  if (existing && opts.force) {
    const idx = entry.releases.findIndex((r) => r.version === version);
    entry.releases[idx] = release;
  } else {
    entry.releases.push(release);
  }
  entry.releases = lib.sortReleasesDesc(entry.releases);

  // 7) 剪枝（可选）
  const removedFiles = [];
  if (opts.prune) {
    const keep = parseInt(opts.keep, 10) || 3;
    const minUsable = parseInt(opts['min-keep'], 10) || 2;
    removedFiles.push.apply(removedFiles, lib.pruneChannel(manifest, channel, keep, minUsable));
    for (const f of removedFiles) {
      const fp = path.join(chDir, f);
      if (fs.existsSync(fp)) {
        fs.unlinkSync(fp);
        console.log('[publish-installer] 剪枝删除: ' + f);
      }
    }
  }

  lib.saveManifestAtomic(root, manifest);
  console.log('[publish-installer] add 完成: ' + channel + ' → ' + version);
  console.log('  文件: ' + exeName + ' (' + check.size + ' B)');
  console.log('  sha256: ' + release.sha256);
  console.log('  sha512: ' + release.sha512.slice(0, 24) + '…（已与 latest.yml 交叉校验一致）');
  console.log('  渠道当前版本:');
  console.log(breakdown(entry.releases));
  if (removedFiles.length) console.log('  已剪枝 ' + removedFiles.length + ' 个文件');
  console.log('  回滚备份: ' + path.join(root, 'manifest.json.bak'));
}

function readYamlVersion(f) {
  try {
    const y = lib.parseLatestYaml(fs.readFileSync(f, 'utf8'));
    return y.version || '?';
  } catch (e) {
    return '?';
  }
}
function validateManifestOrDie(manifest) {
  try {
    lib.validateManifestStructure(manifest);
  } catch (e) {
    fail('现有 manifest 不合法: ' + e.message);
  }
}

// ================= promote =================
async function cmdPromote(opts) {
  const root = resolveRoot(opts.root);
  const channel = String(opts.channel || '');
  if (channel !== 'stable') fail('promote 仅允许 stable 渠道（beta 永不强制更新）');
  const version = String(opts.version || '');
  const required = String(opts.required || '');
  if (!lib.VERSION_RE.test(version)) fail('--version 非法: ' + version);
  if (!lib.VERSION_RE.test(required)) fail('--required 非法: ' + required);
  if (lib.isPrerelease(required)) fail('--required 不允许 prerelease: ' + required);
  if (lib.compareVersions(required, version) >= 0) fail('--required ' + required + ' 必须低于 --version ' + version);
  const manifest = lib.loadManifest(root);
  validateManifestOrDie(manifest);
  const entry = lib.channelOf(manifest, channel);
  const release = entry.releases.find((r) => r.version === version);
  if (!release) fail('渠道 stable 中不存在版本 ' + version);
  if (release.retracted) fail('版本 ' + version + ' 已被撤回，不能设置强制更新');
  const nonRetracted = entry.releases.filter((r) => !r.retracted);
  if (nonRetracted[0] && nonRetracted[0].version !== version) {
    fail('promote 只允许作用于当前最新可用版本（最新为 ' + nonRetracted[0].version + '），已发更新版本时请重新评估');
  }
  release.required = required;
  lib.saveManifestAtomic(root, manifest);
  console.log('[publish-installer] promote 完成: stable ' + version + ' 要求 >= ' + required + ' 强制升级');
  const affected = entry.releases.filter((r) => lib.compareVersions(r.version, required) < 0).map((r) => r.version);
  if (affected.length) {
    console.log('  受影响（将被标记「已停止服务」，自动更新将被强制）: ' + affected.join(', '));
  } else {
    console.log('  当前渠道无低于门槛的版本（仅对未来旧版生效）');
  }
}

// ================= retract =================
async function cmdRetract(opts) {
  const root = resolveRoot(opts.root);
  const channel = String(opts.channel || '');
  if (channel !== 'stable') fail('retract 仅允许 stable 渠道');
  const version = String(opts.version || '');
  const reason = String(opts.reason || '');
  if (!lib.VERSION_RE.test(version)) fail('--version 非法: ' + version);
  if (!reason) fail('--reason 必填（将展示在下载页）');
  const manifest = lib.loadManifest(root);
  validateManifestOrDie(manifest);
  const entry = lib.channelOf(manifest, channel);
  const release = entry.releases.find((r) => r.version === version);
  if (!release) fail('渠道 stable 中不存在版本 ' + version);
  if (release.retracted) fail('版本 ' + version + ' 已被撤回');
  release.retracted = { reason, at: new Date().toISOString() };
  let cleared = false;
  if (release.required) {
    console.log('[publish-installer] 自动清除该版本的强制门槛（防止升级死循环）: ' + release.required);
    release.required = null;
    cleared = true;
  }
  lib.saveManifestAtomic(root, manifest);
  const top = entry.releases.find((r) => !r.retracted);
  console.log('[publish-installer] retract 完成: stable ' + version + ' 已撤回（文件保留在磁盘，待人工清理）');
  if (cleared) console.log('  已同步清除 required');
  console.log('  当前最新可用版本: ' + (top ? top.version : '（无）'));
  console.log('  下载页与桌面端将自动提示用户回退。紧急修复流程见 docs/PUBLISHING.md');
}

// ================= verify =================
async function cmdVerify(opts) {
  const file = path.resolve(String(opts.file || ''));
  if (!file || !fs.existsSync(file)) fail('--file 不存在: ' + file);
  const size = fs.statSync(file).size;
  const sha256 = await lib.sha256File(file);
  console.log('  文件: ' + path.basename(file));
  console.log('  大小: ' + size + ' B');
  console.log('  sha256: ' + sha256);
  if (opts.sha256) {
    const expected = String(opts.sha256).toLowerCase();
    if (sha256 === expected) {
      console.log('  校验: 一致 ✓');
    } else {
      console.error('  校验: 不一致 ✗（期望 ' + expected + '）');
      process.exit(1);
    }
  }
}

// ================= ls =================
async function cmdLs(opts) {
  const root = resolveRoot(opts.root);
  const manifest = lib.loadManifest(root);
  validateManifestOrDie(manifest);
  const only = opts.channel ? String(opts.channel) : null;
  if (only && !lib.CHANNELS.includes(only)) fail('未知渠道: ' + only);
  for (const ch of lib.CHANNELS) {
    if (only && ch !== only) continue;
    const entry = manifest.channels[ch];
    console.log('[' + ch + ']');
    if (!entry || !entry.releases.length) {
      console.log('  （无版本）');
      continue;
    }
    const sorted = lib.sortReleasesDesc(entry.releases).map((r) => {
      const marks = [];
      const m = { version: r.version, fileName: r.fileName, size: r.sizeBytes, sha256: (r.sha256 || '').slice(0, 16) + '…', required: r.required, retracted: r.retracted ? r.retracted.reason : null };
      if (m.retracted) marks.push('已撤回');
      if (m.required) marks.push('强制>=' + m.required);
      return marks.length ? '  [' + marks.join('] [') + '] ' + m.version + '  ' + m.fileName + '  ' + m.size + 'B' : '  ' + m.version + '  ' + m.fileName + '  ' + m.size + 'B';
    });
    console.log(sorted.join('\n'));
  }
}

// ================= main =================
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0] || '';
  const opts = args;
  try {
    if (cmd === 'add') await cmdAdd(opts);
    else if (cmd === 'promote') await cmdPromote(opts);
    else if (cmd === 'retract') await cmdRetract(opts);
    else if (cmd === 'verify') await cmdVerify(opts);
    else if (cmd === 'ls') await cmdLs(opts);
    else {
      console.log('Qbao 安装包发布工具 v3.35（零依赖）');
      console.log('用法:');
      console.log('  node scripts/publish-installer.js add --dir <暂存> --channel stable|beta [--notes "说明"] [--prune] [--keep N]');
      console.log('  node scripts/publish-installer.js promote --channel stable --version X --required Y');
      console.log('  node scripts/publish-installer.js retract --channel stable --version X --reason "原因"');
      console.log('  node scripts/publish-installer.js verify --file <exe> [--sha256 <期望>]');
      console.log('  node scripts/publish-installer.js ls');
      console.log('通用参数: --root <下载根目录>（默认 ./downloads）');
      process.exit(cmd === '--help' || cmd === 'help' ? 0 : 1);
    }
  } catch (e) {
    fail(e.message);
  }
}

main();