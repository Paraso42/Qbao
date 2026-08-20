'use strict';

// ============================================================
// bootstrap_admin.js — 为已有部署提升/创建管理员账号（T3）
//
// 用法：
//   node scripts/bootstrap_admin.js <username> <password>
//
// 行为：
//   1. 账号不存在 → 创建为 admin（同时写入 ADMIN_USERNAMES 同名账号）；
//   2. 账号存在   → 将其 role 提升为 admin；
//   3. 全程幂等，可重复执行；非交互，适合部署脚本调用。
//
// 注意：新部署请优先在 server/.env 中配置 ADMIN_USERNAMES，
//       首个注册用户且用户名在其中时才会自动成为 admin。
// ============================================================

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { pool } = require('../src/db');
const { hashPassword } = require('../src/auth');

async function main() {
  const username = (process.argv[2] || '').trim();
  const password = process.argv[3] || '';
  if (!username || !password) {
    console.error('用法: node scripts/bootstrap_admin.js <用户名> <密码>');
    return 2;
  }
  if (password.length < 6) {
    console.error('密码长度至少 6 位');
    return 2;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query('SELECT id, role FROM users WHERE username = $1', [username]);
    if (existing.rows.length === 0) {
      const hash = await hashPassword(password);
      await client.query(
        'INSERT INTO users (username, password_hash, display_name, role) VALUES ($1, $2, $3, $4)',
        [username, hash, username, 'admin']
      );
      console.log('[bootstrap_admin] 已创建管理员账号: ' + username);
    } else {
      if (existing.rows[0].role === 'admin') {
        console.log('[bootstrap_admin] 账号已是管理员，无需变更: ' + username);
      } else {
        await client.query('UPDATE users SET role = $2 WHERE id = $1', [existing.rows[0].id, 'admin']);
        console.log('[bootstrap_admin] 已将账号提升为管理员: ' + username);
      }
    }

    await client.query('COMMIT');
    return 0;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('[bootstrap_admin] 失败: ' + e.message);
    return 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main()
  .then((code) => { process.exitCode = code || 0; })
  .catch((e) => {
    console.error('[bootstrap_admin] unexpected:', e);
    process.exitCode = 1;
  });
