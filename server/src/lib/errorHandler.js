'use strict';

const { ApiError } = require('./ApiError');

// Express 4 不捕获 async 路由的 rejection（会变成未处理 Promise 拒绝）。
// 所有 async 路由统一用 asyncHandler 包裹，抛错/拒绝一律进入全局 errorHandler。
function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// 未匹配任何路由的兜底
function notFoundHandler(req, res) {
  res.status(404).json({ error: '接口不存在' });
}

// 全局错误处理中间件（必须在所有路由之后注册）。
// 统一响应格式 { error: string, ...details }，不向客户端泄露内部错误细节。
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  // 1) 业务错误
  if (err instanceof ApiError) {
    const body = { error: err.message };
    if (err.details && typeof err.details === 'object') Object.assign(body, err.details);
    return res.status(err.status).json(body);
  }

  // 2) body-parser 解析错误（坏 JSON / 请求体过大）
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: '请求体不是合法 JSON' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: '请求体过大' });
  }

  // 3) PostgreSQL 错误（code 为 5 位字符，如 23505 唯一约束冲突）
  if (err.code && typeof err.code === 'string' && err.code.length === 5) {
    console.error('[db]', err.code, err.message);
    return res.status(500).json({ error: '数据库错误，请稍后重试' });
  }

  // 4) 其余未知错误
  console.error('[error]', err && err.stack ? err.stack : err);
  res.status(500).json({ error: '服务器内部错误' });
}

module.exports = { asyncHandler, notFoundHandler, errorHandler, ApiError };
