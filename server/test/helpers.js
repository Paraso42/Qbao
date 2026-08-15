'use strict';

const { pool } = require('../src/db');

// 用可控假查询替换连接池查询（测试不触真实数据库）。
// matchers: [正则, handler(sql, params)][]，按顺序匹配；无匹配返回空结果。
function installFakePool(matchers) {
  const fn = async (sql, params) => {
    for (const [pattern, handler] of matchers) {
      if (pattern.test(sql)) return handler(sql, params);
    }
    return { rows: [], rowCount: 0 };
  };
  pool.query = fn;
  return fn;
}

module.exports = { installFakePool };
