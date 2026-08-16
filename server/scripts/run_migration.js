'use strict';

// Node 版 SQL 迁移执行器（v3.27）
// 用于没有 psql 命令的环境，直接通过 pg 连接执行迁移文件。
// 用法：
//   node scripts/run_migration.js sql/migration_v3.27_file_extract_cache.sql
//   node scripts/run_migration.js migration_v3.27_file_extract_cache.sql
// 迁移在事务中执行；任一语句失败会整体回滚。

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: __dirname + '/../.env' });

const { pool } = require('../src/db');

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error('用法: node scripts/run_migration.js <sql文件或文件名>');
    return 2;
  }

  const serverRoot = path.join(__dirname, '..');
  const candidatePaths = [
    path.resolve(serverRoot, input),
    path.resolve(serverRoot, 'sql', input),
  ];
  const sqlPath = candidatePaths.find((p) => fs.existsSync(p));

  if (!sqlPath) {
    console.error('[migration] 找不到迁移文件: ' + input);
    console.error('[migration] 已尝试: ' + candidatePaths.join(' , '));
    return 2;
  }

  const sql = fs.readFileSync(sqlPath, 'utf8');
  let client;
    try {
      client = await pool.connect();
    } catch (e) {
      console.error('[migration] 无法连接 PostgreSQL：' + e.message);
      console.error('[migration] 请确认 PostgreSQL 已启动，并检查 server/.env 中 PGHOST/PGPORT/PGUSER/PGPASSWORD。');
      try { await pool.end(); } catch (_) {}
      return 2;
    }

  try {
    console.log('[migration] 开始执行:', sqlPath);
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('[migration] 完成:', path.basename(sqlPath));
    return 0;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('[migration] 执行失败，已回滚:', e.message);
    return 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main()
  .then((code) => { process.exitCode = code || 0; })
  .catch((e) => {
    console.error('[migration] unexpected:', e);
    process.exitCode = 1;
  });
