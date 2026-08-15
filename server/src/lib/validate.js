'use strict';

const { ZodError } = require('zod');
const { ApiError } = require('./ApiError');

// 请求参数校验中间件工厂（zod schema）。
// 用法：app.put('/api/v1/data', validate({ body: putDataSchema }), requireAuth, handler)
// 解析成功后写回 req（body/params 整体替换；query 合并，未知键被剔除、类型被强制）。
// 校验失败 → 422 { error: '...' }。
function validate(schemas) {
  const { body, query, params } = schemas || {};
  return function (req, res, next) {
    try {
      if (body) req.body = body.parse(req.body === undefined ? {} : req.body);
      if (query) Object.assign(req.query, query.parse(req.query || {}));
      if (params) req.params = params.parse(req.params || {});
      next();
    } catch (e) {
      if (e instanceof ZodError) {
        const first = e.issues[0];
        const path = first.path.join('.');
        return next(new ApiError(422, path ? first.message + '（' + path + '）' : first.message));
      }
      next(e);
    }
  };
}

module.exports = { validate };
