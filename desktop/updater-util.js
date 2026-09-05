'use strict';

// 桌面端更新纯函数工具（v3.35 · 不依赖 electron，可 node:test 单测）
// 与服务器 manifest 纪律保持一致：feed URL 拼接、强制门槛判定、撤回判定、下载参数白名单校验。

const FILE_RE = /^Qbao-Setup-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.exe$/i;
const SHA256_RE = /^[0-9a-f]{64}$/i;

// apiBase（含 /api/v1 后缀）→ generic feed 根 URL；非法/为空返回 null
function buildFeedUrl(apiBase, channel) {
  if (!apiBase) return null;
  const base = String(apiBase).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(base)) return null;
  return base + '/desktop/update/' + (channel === 'beta' ? 'beta' : 'stable');
}

function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] - pb.nums[i];
  }
  if (pa.pre === null && pb.pre === null) return 0;
  if (pa.pre === null) return 1;
  if (pb.pre === null) return -1;
  const ta = pa.pre.split('.');
  const tb = pb.pre.split('.');
  for (let i = 0; i < Math.max(ta.length, tb.length); i++) {
    if (i >= ta.length) return -1;
    if (i >= tb.length) return 1;
    const x = ta[i];
    const y = tb[i];
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      if (Number(x) !== Number(y)) return Number(x) - Number(y);
    } else if (xNum !== yNum) {
      return xNum ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

function parseVersion(v) {
  const m = String(v).match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!m) throw new Error('非法版本号: ' + v);
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] === undefined ? null : m[4] };
}

// 是否需要强制升级：required 存在且当前版本低于门槛
function shouldForceUpdate(currentVersion, required) {
  if (!required) return false;
  return compareVersions(currentVersion, required) < 0;
}

// 当前已安装版本是否已被撤回：列表非空且不含当前版本
function isInstalledVersionRetracted(currentVersion, releases) {
  if (!releases || !Array.isArray(releases) || releases.length === 0) return false;
  return !releases.some((r) => r && r.version === currentVersion);
}

// 下载指定版本参数校验（renderer 仅能传 manifest 给出的 fileName/version/sha256）
function validateDownloadArgs(args) {
  const a = args || {};
  if (typeof a.fileName !== 'string' || !FILE_RE.test(a.fileName)) return { ok: false, error: '文件名非法' };
  const m = FILE_RE.exec(a.fileName);
  if (!m || !m[1]) return { ok: false, error: '文件名非法' };
  if (typeof a.version !== 'string' || a.version !== m[1]) return { ok: false, error: '文件名与版本不一致' };
  if (typeof a.sha256 !== 'string' || !SHA256_RE.test(a.sha256)) return { ok: false, error: 'sha256 非法' };
  return { ok: true, version: m[1], fileName: a.fileName, sha256: a.sha256 };
}

module.exports = {
  FILE_RE,
  buildFeedUrl,
  compareVersions,
  shouldForceUpdate,
  isInstalledVersionRetracted,
  validateDownloadArgs,
};
