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
    // 2.5) multer 上传错误（类型白名单/大小限制等）
    // R12：原实现把所有 multer 错误一律映射 422，且直接回显 err.message。
    // multer 的 message 是英文枚举（'File too large' / 'LIMIT_FILE_COUNT' …），
    // 对用户不可读；更糟的是「单文件超过 20MB」这类体积问题被报成 422 参数错误。
    // 现在按 code 分流：体积类 → 413，其余（类型/数量/字段名）→ 422，并给中文文案。
    if (err.name === 'MulterError' || err.status === 422) {
      const MULTER_MESSAGES = {
        LIMIT_FILE_SIZE: '单个文件超过 20MB 上限',
        LIMIT_FILE_COUNT: '单次上传文件数量超出上限',
        LIMIT_UNEXPECTED_FILE: '上传字段名不正确',
        LIMIT_PART_COUNT: '上传分片数量超出上限',
        LIMIT_FIELD_COUNT: '上传表单字段数量超出上限',
        LIMIT_FIELD_KEY: '上传表单字段名过长',
        LIMIT_FIELD_VALUE: '上传表单字段值过长',
      };
      const known = err.name === 'MulterError' ? MULTER_MESSAGES[err.code] : null;
      const status = err.name === 'MulterError' && (err.code === 'LIMIT_FILE_SIZE' || err.code === 'LIMIT_PART_COUNT') ? 413 : 422;
      // err.status 分支（业务侧显式 422）保留原 message，因为它已经是产品文案
      return res.status(status).json({ error: known || err.message || '上传失败' });
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
