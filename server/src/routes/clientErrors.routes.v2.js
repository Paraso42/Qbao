'use strict';

// 客户端错误上报（P1-3）
//
// 背景：前端此前没有任何错误出口 —— Vue 渲染错误与未捕获的 Promise 拒绝只进浏览器
// 控制台。网页端尚可让用户截图，桌面端（Electron）用户拿不到任何线索，只能报「没反应」。
//
// 设计取舍：
//   * 不需要登录：崩溃/引导失败可能发生在登录之前，要求鉴权等于丢掉最关键的那批错误；
//   * 不落库：只写服务端日志（pm2/docker 日志已集中收集），避免为噪音建表、
//     也避免匿名端点成为磁盘放大器；
//   * 严格限流 + 体积上限：匿名可写日志必须防刷（每 IP 每分钟 20 条，body ≤ 8KB）；
//   * 只透传白名单字段：name/message/stack/context/url/ua，绝不回显整个 body。
const { asyncHandler } = require('../lib/errorHandler');

const MAX_BODY_BYTES = 8 * 1024;
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 20;
const MAX_FIELD_LEN = 600;

// 单进程内存限流（与 chat 在线状态同级别：本服务为单实例部署，见 docs/DEPLOY.md）
const hits = new Map();

function clientKey(req) {
  return req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
}

function allow(key, now) {
  const arr = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= MAX_PER_WINDOW) {
    hits.set(key, arr);
    return false;
  }
  arr.push(now);
  hits.set(key, arr);
  // 轻度清理：避免 Map 无界增长
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (!v.length || now - v[v.length - 1] > WINDOW_MS * 5) hits.delete(k);
    }
  }
  return true;
}

function str(v) {
  if (typeof v !== 'string') return '';
  return v.replace(/\s+/g, ' ').slice(0, MAX_FIELD_LEN);
}

module.exports = function (app) {
  app.post('/api/v1/client-errors', asyncHandler(async (req, res) => {
    // 体积闸门：express.json 已在 app.js 限制整体 body，这里再按本端点收紧
    const raw = JSON.stringify(req.body || {});
    if (raw.length > MAX_BODY_BYTES) return res.status(413).json({ error: 'payload too large' });

    if (!allow(clientKey(req), Date.now())) return res.status(429).json({ error: 'too many reports' });

    const b = req.body || {};
    const line = {
      name: str(b.name) || 'Error',
      message: str(b.message),
      stack: str(b.stack),
      context: str(b.context),
      url: str(b.url),
      ua: str(b.ua),
      userId: req.userId || null,
    };
    if (!line.message && !line.stack) return res.status(204).end();

    console.warn('[client-error] ' + JSON.stringify(line));
    // 204：前端 fire-and-forget，不需要响应体
    res.status(204).end();
  }));
};
