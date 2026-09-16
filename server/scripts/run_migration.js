'use strict';

// ============================================================
// 版本化迁移执行器（T17）
// 追踪表 schema_migrations(version, applied_at)：
//   - 默认：按文件名顺序执行所有未应用迁移，每个迁移独立事务；
//   - --list：列出待执行迁移；--verify：只校验仓库迁移文件与库内记录的一致性；
//     编号存在「空洞」（如 015）是允许的（历史空号），但会显式打印出来，
//     以便和「文件被误删」区分开 —— 后者才是真正的危险状态；
//   - --mark-applied：不执行，仅把当前全部迁移标记为已应用
//     （旧库已手工执行过迁移文件时的引导方式）；
//   - <文件>：单独执行指定迁移文件并记录（兼容旧用法）。
// 用法：
//   node scripts/run_migration.js
//   node scripts/run_migration.js --list
//   node scripts/run_migration.js --verify
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
  if (arg && arg !== '--list' && arg !== '--mark-applied' && arg !== '--verify') {
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

    // —— 编号连续性诊断（不阻断）——
    // 本仓库 015 是历史空号（从未有对应文件）。为避免「空号」与「文件被误删」
    // 被混为一谈，这里同时打印两类信息：
    //   (a) 仓库内编号空洞（空号，允许）；
    //   (b) 库内已应用但仓库已无对应文件（危险，通常意味着迁移文件被误删）。
    const nums = files.map((f) => Number(f.slice(0, 3)));
    const gaps = [];
    for (let n = Math.min.apply(null, nums); n <= Math.max.apply(null, nums); n++) {
      if (nums.indexOf(n) === -1) gaps.push(String(n).padStart(3, '0'));
    }
    const orphans = Array.from(applied).filter((v) => /^\d{3}_/.test(v) && files.indexOf(v) === -1);
    const diagnose = () => {
      if (gaps.length) console.log('[migration] 编号空号（历史遗留，允许）: ' + gaps.join(', '));
      if (orphans.length) {
        console.warn('[migration] 警告：库内已应用但仓库已无对应文件: ' + orphans.join(', ') +
          ' —— 请确认迁移文件不是被误删（否则新环境无法复现该库结构）');
      }
    };

    if (arg === '--list') {
      diagnose();
      console.log('[migration] 已应用 ' + files.length + ' 个迁移中的 ' + (files.length - pending.length) + ' 个：');
      files.forEach((f) => console.log('  ' + (applied.has(f) ? '[x]' : '[ ]') + ' ' + f));
      return pending.length === 0 ? 0 : 2;
    }

    if (arg === '--verify') {
      diagnose();
      console.log('[migration] 仓库迁移文件 ' + files.length + ' 个，库内已应用 ' + applied.size + ' 个，待执行 ' + pending.length + ' 个');
      if (pending.length) pending.forEach((f) => console.log('  待执行: ' + f));
      return 0;
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
