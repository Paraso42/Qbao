'use strict';

const { errorHandler, ApiError } = require('../src/lib/errorHandler');

function mockRes() {
  const res = {};
  res.statusCode = 200;
  res.headersSent = false;
  res.status = vi.fn(function (code) { res.statusCode = code; return res; });
  res.json = vi.fn(function (body) { res.body = body; return res; });
  return res;
}

describe('errorHandler 单元测试', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('ApiError → 对应状态码，details 浅合并进响应体', () => {
    const res = mockRes();
    errorHandler(new ApiError(409, '数据版本冲突', { current: { rev: 3 } }), {}, res, vi.fn());
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: '数据版本冲突', current: { rev: 3 } });
  });

  it('未知错误 → 500，不泄露内部信息', () => {
    const res = mockRes();
    errorHandler(new Error('secret internal detail'), {}, res, vi.fn());
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe('服务器内部错误');
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });

  it('pg 错误 → 500 数据库错误', () => {
    const res = mockRes();
    const pgErr = new Error('duplicate key value');
    pgErr.code = '23505';
    errorHandler(pgErr, {}, res, vi.fn());
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe('数据库错误，请稍后重试');
  });
});
