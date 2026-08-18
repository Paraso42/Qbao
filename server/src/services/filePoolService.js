'use strict';

// 文件池公共服务（v3.28）：
// - cleanupExpiredFiles 从 routes/files.routes.js / files.routes.v2.js 迁出，
//   供文件接口与 AI 出题（ai.routes.js）共用，保证读池前先清理过期文件。

const { pool } = require('../db');
const fs = require('fs');
const path = require('path');

const UPLOAD_BASE = path.join(__dirname, '../../../uploads'); // server/uploads 共享文件池根

// 清理某用户所有已过期文件池文件（DB 记录 + 磁盘文件），返回清理条数。
async function cleanupExpiredFiles(userId) {
  try {
    const result = await pool.query(
      `DELETE FROM user_files WHERE user_id = $1 AND in_pool = true
       AND pool_expires_at IS NOT NULL AND pool_expires_at < NOW() RETURNING file_path`,
      [userId]
    );
    for (const row of result.rows) {
      const absPath = path.join(UPLOAD_BASE, row.file_path);
      try { if (fs.existsSync(absPath)) fs.unlinkSync(absPath); } catch (e) { /* ignore */ }
    }
    if (result.rows.length > 0) {
      console.log('[file-pool] cleanupExpiredFiles userId=' + userId + ' removed=' + result.rows.length);
    }
    return result.rows.length;
  } catch (e) {
    console.error('cleanupExpiredFiles error:', e.message);
    return 0;
  }
}

module.exports = { cleanupExpiredFiles };