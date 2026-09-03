'use strict';

const { pool } = require('../src/db');

// 用可控假查询替换连接池查询（测试不触真实数据库）。
// matchers: [正则, handler(sql, params)][]，按顺序匹配；无匹配返回空结果。
// P0.7: 事务类服务（积分配额等）在真实池上会走 pool.connect —— 默认把 connect 也
// 替换成 fake client（BEGIN/COMMIT/ROLLBACK/advisory 直接放行，其余委托 matcher），
// 使带事务的调用封闭可测，不触真实 PostgreSQL（本机有库/CI 无库行为一致）。
function installFakePool(matchers) {
  const fn = async (sql, params) => {
    for (const [pattern, handler] of matchers) {
      if (pattern.test(sql)) return handler(sql, params);
    }
    return { rows: [], rowCount: 0 };
  };
  pool.query = fn;
  pool.connect = async () => ({
    query: async (sql, params = []) => {
      const s = String(sql).trim();
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(s)) return { rows: [] };
      if (/pg_advisory_xact_lock/.test(sql)) return { rows: [] };
      return fn(sql, params);
    },
    release: () => {},
  });
  return fn;
}

module.exports = { installFakePool };
