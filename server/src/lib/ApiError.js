'use strict';

// 业务错误：由全局 errorHandler 统一转换为 JSON 响应。
// status: HTTP 状态码；details: 可选附加字段（如 409 冲突时的 current 快照），
// 会被浅合并进响应体，例如 { error: '数据版本冲突', current: {...} }。
class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    if (details !== undefined) this.details = details;
    this.isApiError = true;
  }
}

module.exports = { ApiError };
