'use strict';

// AI 资料提取缓存（v3.27）
// user_files 增加提取缓存列后，同一文件只在磁盘内容变化时重新解析；
// 迁移尚未执行时自动退化为“每次都提取”，不影响旧库运行。

const fs = require('fs');
const crypto = require('crypto');
const { pool } = require('../db');

const EXTRACTED_TEXT_MAX = 2_000_000; // 200 万字符，避免把超大提取结果写进数据库。

function hasCacheColumns(row) {
  return !!row && Object.prototype.hasOwnProperty.call(row, 'extract_status');
}

function isCacheValid(row, stat, mtimeMs) {
  return (
    hasCacheColumns(row) &&
    (row.extract_status === 'ok' || row.extract_status === 'empty') &&
    row.extracted_text !== null &&
    row.extracted_text !== undefined &&
    row.source_size === stat.size &&
    row.source_mtime_ms === mtimeMs
  );
}

// 返回与旧 extractText() 兼容的结构，并尽量写入缓存。
async function getCachedOrExtractFileText(row, absPath, ext, extractText) {
  const stat = fs.statSync(absPath);
  const mtimeMs = Math.floor(stat.mtimeMs);

  if (isCacheValid(row, stat, mtimeMs)) {
    return {
      type: 'text',
      content: row.extracted_text,
      extracted: true,
      empty: !row.extracted_text.trim(),
      cached: true,
    };
  }

  const extracted = await extractText(absPath, ext);
  const text = extracted && extracted.type === 'text' ? (extracted.content || '') : '';
  const safeText = text.slice(0, EXTRACTED_TEXT_MAX);
  const status = extracted.extracted ? (safeText.trim() ? 'ok' : 'empty') : 'error';

  if (hasCacheColumns(row)) {
    try {
      const textHash = crypto.createHash('sha256').update(safeText).digest('hex');
      await pool.query(
        `UPDATE user_files
         SET extract_status = $2,
             extracted_text = $3,
             text_hash = $4,
             source_mtime_ms = $5,
             source_size = $6
         WHERE id = $1`,
        [row.id, status, safeText, textHash, mtimeMs, stat.size]
      );
    } catch (e) {
      console.warn('[ai-material-cache] update failed:', e.message);
    }
  }

  return {
    type: 'text',
    content: safeText,
    extracted: extracted.extracted,
    empty: extracted.empty || !safeText.trim(),
    error: extracted.error,
    warning: extracted.warning,
    cached: false,
  };
}

module.exports = {
  EXTRACTED_TEXT_MAX,
  getCachedOrExtractFileText,
};
