'use strict';

// ============================================================
// mediaLimits.js — 媒体下载侧的「次数 + 流量」双闸门（v3.37.7）
// ============================================================
//
// 为什么必须单独做：
//   1) 媒体端点（/chat/files、/issues/images）用签名 ticket 鉴权，票在有效期内
//      可以无限次重放 —— 只要拿到一个 20MB 附件的 URL，就能反复拉，持续占用
//      服务器出口带宽（本机在香港、跨境按流量计费）；
//   2) 浏览器加载一屏聊天图片会瞬间打出几十个并发请求，而校园网 NAT 出口
//      可能几百人共享同一个公网 IP，套用通用限流（app.js 的 120/min/IP）
//      会把正常浏览也一起拦掉。
//
// 于是把两件事拆开：
//   * 次数：媒体路径从通用限流里豁免（app.js 用 isMediaRequest 做 skip），
//     改由 mediaLimiter 单独计数，额度更宽（MEDIA_DOWNLOAD_MAX_PER_MIN）；
//   * 流量：真正的兜底是这里 —— 按 IP 累计窗口内**实际发出的字节**，超了就 429。
//     正常浏览一屏图 ≈ 25MB，而重放一个 20MB 附件刷十几次就会触顶。
//
// 单进程内存实现（与 chat 在线状态、clientErrors 限流同级别：本服务单实例部署，
// 见 docs/DEPLOY.md）。
// ============================================================

const { MEDIA_DOWNLOAD_BYTES_PER_10MIN } = require('../config/files');

const MEDIA_PATH_PREFIXES = ['/api/v1/chat/files/', '/api/v1/issues/images/'];

// req.originalUrl 才带完整路径：app.use('/api/v1/', mw) 之后 req.url 已被剥掉前缀。
function mediaRequestPath(req) {
  const raw = (req && (req.originalUrl || req.url)) || '';
  return String(raw).split('?')[0];
}

function isMediaRequest(req) {
  const p = mediaRequestPath(req);
  return MEDIA_PATH_PREFIXES.some((prefix) => p.indexOf(prefix) === 0);
}

function clientKey(req) {
  return (req && (req.ip || (req.socket && req.socket.remoteAddress))) || 'unknown';
}

const MAX_KEYS = 5000;

// 按 key 累计「窗口内字节数」。允许注入 now 以便单测不依赖真实时钟。
function createByteBudget(opts) {
  const options = opts || {};
  const windowMs = options.windowMs || 10 * 60 * 1000;
  const maxBytes = options.maxBytes || MEDIA_DOWNLOAD_BYTES_PER_10MIN;
  const entries = new Map();

  function live(list, now) {
    return list.filter((e) => now - e.t < windowMs);
  }

  function used(key, now) {
    const t = typeof now === 'number' ? now : Date.now();
    const list = live(entries.get(key) || [], t);
    entries.set(key, list);
    return list.reduce((sum, e) => sum + e.bytes, 0);
  }

  // 只查不记账：让「被拒绝的请求」不占用后续额度
  function allows(key, bytes, now) {
    return used(key, now) + (bytes || 0) <= maxBytes;
  }

  function consume(key, bytes, now) {
    const t = typeof now === 'number' ? now : Date.now();
    const list = live(entries.get(key) || [], t);
    list.push({ t: t, bytes: bytes || 0 });
    entries.set(key, list);
    // 轻度清理：避免 Map 无界增长（与 clientErrors 限流同策略）
    if (entries.size > MAX_KEYS) {
      for (const [k, v] of entries) {
        if (!v.length || t - v[v.length - 1].t > windowMs * 3) entries.delete(k);
      }
    }
    return list.reduce((sum, e) => sum + e.bytes, 0);
  }

  function reset() { entries.clear(); }

  return {
    allows: allows,
    consume: consume,
    used: used,
    reset: reset,
    size: function () { return entries.size; },
    windowMs: windowMs,
    maxBytes: maxBytes,
  };
}

// 进程内单例：路由在真正发送前 allows()，发送后 consume()。
const mediaDownloadBudget = createByteBudget({ maxBytes: MEDIA_DOWNLOAD_BYTES_PER_10MIN });

module.exports = {
  MEDIA_PATH_PREFIXES,
  mediaRequestPath,
  isMediaRequest,
  clientKey,
  createByteBudget,
  mediaDownloadBudget,
};
