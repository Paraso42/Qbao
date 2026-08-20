'use strict';

// ============================================================
// 版本化迁移执行器（T17）
// 追踪表 schema_migrations(version, applied_at)：
//   - 默认：按文件名顺序执行所有未应用迁移，每个迁移独立事务；
//   - --list：列出待执行迁移；
//   - --mark-applied：不执行，仅把当前全部迁移标记为已应用
//     （旧库已手工执行过迁移文件时的引导方式）；
//   - <文件>：单独执行指定迁移文件并记录（兼容旧用法）。
// 用法：
//   node scripts/run_migration.js
//   node scripts/run_migration.js --list
//   node scripts/run_migration.js --mark-applied
//   node scripts/run_migration.js sql/003_v3.8.sql
// ============================================================

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: __dirname + '/../.env' });

const { pool } = require('../src/db');

const SQL_DIR = path.join(__dirname, '..', 'sql');

function listMigrations() {
  return fs.readdirSync(SQL_DIR)
    .filter((f) => /^\d{3}_.+\.sql$/.test(f))
    .sort();
}

async function ensureTrackingTable(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}

async function appliedVersions(client) {
  const r = await client.query('SELECT version FROM schema_migrations');
  return new Set(r.rows.map((x) => x.version));
}

async function main() {
  const arg = process.argv[2];
  if (arg && arg !== '--list' && arg !== '--mark-applied') {
    // 兼容旧用法：单文件执行
    const candidatePaths = [
      path.resolve(__dirname, '..', arg),
      path.resolve(SQL_DIR, arg),
    ];
    const sqlPath = candidatePaths.find((p) => fs.existsSync(p));
    if (!sqlPath) {
      console.error('[migration] 找不到迁移文件: ' + arg);
      return 2;
    }
    let client;
    try {
      client = await pool.connect();
    } catch (e) {
      console.error('[migration] 无法连接 PostgreSQL：' + e.message);
      try { await pool.end(); } catch (_) {}
      return 2;
    }
    try {
      await client.query('BEGIN');
      await ensureTrackingTable(client);
      const sql = fs.readFileSync(sqlPath, 'utf8');
      console.log('[migration] 开始执行:', sqlPath);
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING', [path.basename(sqlPath)]);
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

  const files = listMigrations();
  if (files.length === 0) {
    console.error('[migration] sql/ 下没有 NNN_*.sql 迁移文件');
    return 2;
  }

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
    await ensureTrackingTable(client);
    const applied = await appliedVersions(client);
    const pending = files.filter((f) => !applied.has(f));

    if (arg === '--list') {
      console.log('[migration] 已应用 ' + files.length + ' 个迁移中的 ' + (files.length - pending.length) + ' 个：');
      files.forEach((f) => console.log('  ' + (applied.has(f) ? '[x]' : '[ ]') + ' ' + f));
      return pending.length === 0 ? 0 : 2;
    }

    if (arg === '--mark-applied') {
      for (const f of files) {
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING', [f]);
      }
      console.log('[migration] 已标记 ' + files.length + ' 个迁移为已应用（未执行任何 SQL）');
      return 0;
    }

    if (pending.length === 0) {
      console.log('[migration] 数据库已是最新（' + files.length + ' 个迁移全部应用）');
      return 0;
    }

    for (const f of pending) {
      const sqlPath = path.join(SQL_DIR, f);
      const sql = fs.readFileSync(sqlPath, 'utf8');
      console.log('[migration] 开始执行:', f);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING', [f]);
        await client.query('COMMIT');
        console.log('[migration] 完成:', f);
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        console.error('[migration] 执行失败，已回滚:', f, '-', e.message);
        return 1;
      }
    }
    console.log('[migration] 全部完成，共应用 ' + pending.length + ' 个迁移');
    return 0;
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
