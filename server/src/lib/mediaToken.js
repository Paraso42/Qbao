'use strict';

// T2 补强（本轮复查 P0-1）：聊天附件 / 工单图片的下载鉴权。
//
// 背景：这两个端点的消费方是浏览器 <img src>（图片消息、图片预览、工单截图），
// <img> 无法携带 Authorization 头。若只加 requireAuth，图片会全部裂图。
// 因此采用「签名 URL」方案：
//   - 需要鉴权的路由用 requireAuthOrMediaToken 保护；
//   - Authorization 头仍然是被认可的凭证（下载文件走 window.open 之外的路径、脚本调用）；
//   - 图片场景由服务端**出站时**签一个短时效 ticket（?t=exp.sig），前端原样使用；
//     数据库里只存干净路径，ticket 永不入库，避免 query 凭证被长期固化。
//
// 签名密钥派生自 JWT_SECRET（带用途分隔串），不引入新的环境变量。

const crypto = require('crypto');
const { ApiError } = require('./errorHandler');

const TTL_MS = 60 * 60 * 1000; // 票据最短有效期：1 小时
// v3.37.6：签发时刻按 30 分钟对齐（而不是每毫秒都不同）。
//
// 起因：票在 URL 里（?t=），而 URL 是浏览器的缓存键。原先 exp = Date.now()+1h，
// 同一张图每次下发消息列表都会得到**不同的 URL** —— 于是 Cache-Control 再怎么
// 设得漂亮，浏览器缓存命中率也是 0：每次打开带图聊天都要把每张图重新下一遍。
// 现在把签发时刻对齐到 30 分钟桶，同一桶内所有响应产出完全相同的 URL，
// 强缓存得以生效；对齐后再加一个桶宽，保证实际有效期仍有 60~90 分钟。
const BUCKET_MS = 30 * 60 * 1000;

function key() {
  return crypto.createHmac('sha256', String(process.env.JWT_SECRET || ''))
    .update('qbao:media-token:v1')
    .digest();
}

function signToken(filename, ttlMs) {
  if (!filename) return '';
  // 显式传 ttl 的调用方（测试、短票据）保持原来的「此刻 + ttl」语义；
  // 默认签发才走时间桶。
  const exp = ttlMs
    ? Date.now() + ttlMs
    : Math.floor(Date.now() / BUCKET_MS) * BUCKET_MS + TTL_MS + BUCKET_MS;
  const mac = crypto.createHmac('sha256', key()).update(filename + '|' + exp).digest('base64url');
  return exp + '.' + mac;
}

function verifyToken(filename, token) {
  if (!filename || !token || typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const exp = Number(token.slice(0, dot));
  const mac = token.slice(dot + 1);
  if (!Number.isFinite(exp) || exp <= Date.now()) return false;
  const expect = crypto.createHmac('sha256', key()).update(filename + '|' + exp).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expect);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// 给一个 /api/v1/chat/files/<name> 或 /api/v1/issues/images/<name> 相对路径追加 ticket。
function signUrl(url) {
  if (typeof url !== 'string' || !url) return url;
  if (url.indexOf('/api/v1/chat/files/') !== 0 && url.indexOf('/api/v1/issues/images/') !== 0) return url;
  const name = url.slice(url.lastIndexOf('/') + 1);
  const t = signToken(name);
  if (!t) return url;
  return url + (url.indexOf('?') === -1 ? '?' : '&') + 't=' + t;
}

// 路由守卫：Bearer 头 或 有效 ticket（仅 ticket 时不写 req.userId）
function requireAuthOrMediaToken(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.indexOf('Bearer ') === 0 ? header.slice(7) : '';
  if (token) return require('../middleware').requireAuth(req, res, next);
  if (verifyToken(req.params.filename, req.query && req.query.t)) return next();
  throw new ApiError(401, '请先登录');
}

// 出站脱敏 + 签名：把 messages 行里存量的（可能带 ticket 的）chat 附件路径
// 归一化后重新签名。用于 GET/POST 两类消息返回，保证库里存的永远是干净路径。
function sanitizeMediaUrl(url) {
  if (typeof url !== 'string' || !url) return url;
  if (url.indexOf('/api/v1/chat/files/') !== 0 && url.indexOf('/api/v1/issues/images/') !== 0) return url;
  const q = url.indexOf('?');
  const clean = q === -1 ? url : url.slice(0, q);
  return signUrl(clean);
}

function sanitizeMessageRows(rows) {
  if (!Array.isArray(rows)) return rows;
  for (const m of rows) {
    if (!m || typeof m !== 'object') continue;
    if (Array.isArray(m.images)) m.images = m.images.map(sanitizeMediaUrl);
    if (m.file_info && typeof m.file_info === 'object' && m.file_info.url) {
      m.file_info = Object.assign({}, m.file_info, { url: sanitizeMediaUrl(m.file_info.url) });
    }
  }
  return rows;
}

module.exports = { signToken, verifyToken, signUrl, sanitizeMediaUrl, sanitizeMessageRows, requireAuthOrMediaToken, TTL_MS, BUCKET_MS };
