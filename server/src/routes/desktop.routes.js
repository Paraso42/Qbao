'use strict';

// 桌面端国内镜像分发（v3.34.1）
// 背景：多数用户网络无法稳定访问 GitHub → 网页端「桌面端」页不再跳 GitHub Release，
// 改由本站服务器直接分发安装包（配合 app SettingsModal 网页版视图）。
// 文件目录：QBAO_DESKTOP_DIR（默认 <server>/../downloads），文件名 Qbao-Setup-<semver>.exe，
// 可选同目录 meta.json（由放包脚本写入：{ version, fileName, sha256, size, publishedAt }）。
// 端点（公开、无鉴权；仅静态文件信息，不含任何用户数据）：
//   GET /api/v1/desktop/latest    → 最新版信息（版本/大小/SHA256/发布日期）
//   GET /api/v1/desktop/download  → 附件方式下载最新安装包（支持断点续传）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE_RE = /^Qbao-Setup-(\d+)\.(\d+)\.(\d+)\.exe$/i;

function downloadsDir() {
  // 默认 <repo根>/downloads（server/src/routes 上溯三级）；位于 server/ 之外，
  // 部署时不会被 deploy 清理脚本删除——服务器即安装包储藏室
  return process.env.QBAO_DESKTOP_DIR || path.join(__dirname, '..', '..', '..', 'downloads');
}

function listInstallers() {
  let names = [];
  try { names = fs.readdirSync(downloadsDir()); } catch (e) { return []; }
  return names
    .map((name) => {
      const m = FILE_RE.exec(name);
      if (!m) return null;
      return {
        name,
        abs: path.join(downloadsDir(), name),
        version: m[1] + '.' + m[2] + '.' + m[3],
        ver: { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) },
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.ver.major - a.ver.major) || (b.ver.minor - a.ver.minor) || (b.ver.patch - a.ver.patch));
}

function readMeta() {
  try {
    return JSON.parse(fs.readFileSync(path.join(downloadsDir(), 'meta.json'), 'utf8'));
  } catch (e) {
    return null;
  }
}

// sha256 兜底（meta.json 缺失时惰性计算一次并缓存）
const shaCache = new Map();
function sha256Of(abs) {
  if (!shaCache.has(abs)) {
    shaCache.set(abs, new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(abs);
      stream.on('error', reject);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
    }).catch((e) => { shaCache.delete(abs); throw e; }));
  }
  return shaCache.get(abs);
}

function latestInstaller() {
  const files = listInstallers();
  return files.length > 0 ? files[0] : null;
}

module.exports = function desktopRoutes(app) {
  app.get('/api/v1/desktop/latest', async (req, res) => {
    try {
      const top = latestInstaller();
      if (!top) {
        return res.status(404).json({ ok: false, error: '桌面端安装包暂未发布，请稍后再试' });
      }
      const meta = readMeta();
      const metaMatch = meta && meta.fileName === top.name ? meta : null;
      let sha256 = (metaMatch && metaMatch.sha256) || '';
      let sizeBytes = (metaMatch && metaMatch.size) || 0;
      if (!sha256) sha256 = await sha256Of(top.abs);
      if (!sizeBytes) {
        try { sizeBytes = fs.statSync(top.abs).size; } catch (e) { sizeBytes = 0; }
      }
      res.json({
        ok: true,
        version: top.version,
        fileName: top.name,
        sizeBytes,
        sha256,
        publishedAt: (metaMatch && metaMatch.publishedAt) || null,
        downloadUrl: '/api/v1/desktop/download',
      });
    } catch (e) {
      console.error('[desktop] latest error:', e.message);
      if (!res.headersSent) res.status(500).json({ ok: false, error: '服务器内部错误' });
    }
  });

  app.get('/api/v1/desktop/download', (req, res) => {
    const top = latestInstaller();
    if (!top) {
      return res.status(404).json({ ok: false, error: '桌面端安装包暂未发布，请稍后再试' });
    }
    res.download(top.abs, top.name, (err) => {
      if (!err) return;
      if (!res.headersSent) res.status(404).json({ ok: false, error: '安装包读取失败' });
      else res.end();
    });
  });

  // 短链别名：https://<host>/download → 最新安装包（方便口头分发）
  app.get('/download', (req, res) => {
    res.redirect(302, '/api/v1/desktop/download');
  });
};
