'use strict';

// 文件池资料文本加载（共享模块）
// 章节若分配了文件池文件（user_files_chapters 关联表），从磁盘提取文本并入出题内容。
// 供两条生成链路使用：/ai/generate（流式/非流式）与后台任务队列（aiTaskService）——
// 修复：后台任务此前只使用客户端提交的 textContent，而客户端会排除 _poolFile 资料，
// 导致"文件池分配的资料 + 服务端任务队列"出题时资料为空，生成与材料无关的题目。

const fs = require('fs');
const path = require('path');
const { pool } = require('../db');
const { getCachedOrExtractFileText } = require('../services/aiMaterialCache');
const { cleanupExpiredFiles } = require('../services/filePoolService');
const { extractText } = require('./extractText');

// 上传根目录统一为仓库级 uploads/（与 chat/issues/pool/avatars 一致）
const POOL_BASE = path.join(__dirname, '../../../uploads');

/**
 * 加载指定章节分配的文件池资料文本，并入基础文本（客户端上传文本）。
 * @param {number} userId
 * @param {string|null} chapterId
 * @param {string} baseText 客户端提交的 textContent（可能为空）
 * @returns {Promise<{text: string, poolFilesStatus: Array}>}
 */
async function loadPoolTextForChapter(userId, chapterId, baseText) {
  let userText = baseText || '';
  const poolFilesStatus = [];
  if (!chapterId) return { text: userText, poolFilesStatus };

  try {
    // 过期文件池文件：先标记诊断条目，再统一清理，读取时按过期时间过滤
    // v3.30 多章节关联：按关联表读取章节的文件池文件
    const expiredRows = await pool.query(
      `SELECT f.original_name FROM user_files f
       JOIN user_files_chapters fc ON fc.file_id = f.id
       WHERE fc.user_id = $1 AND fc.chapter_id = $2
         AND f.in_pool = true AND f.pool_expires_at IS NOT NULL AND f.pool_expires_at < NOW()`,
      [userId, chapterId]
    );
    if (expiredRows.rows.length > 0) {
      expiredRows.rows.forEach((r) => {
        poolFilesStatus.push({
          name: r.original_name, found: false, extracted: false, empty: true,
          expired: true, error: '文件池文件已过期，已删除',
        });
      });
      await cleanupExpiredFiles(userId);
    }

    const fileResult = await pool.query(
      `SELECT f.* FROM user_files f
       JOIN user_files_chapters fc ON fc.file_id = f.id
       WHERE fc.user_id = $1 AND fc.chapter_id = $2
         AND (f.pool_expires_at IS NULL OR f.pool_expires_at > NOW())`,
      [userId, chapterId]
    );

    const poolTexts = [];
    for (const frow of fileResult.rows) {
      const statusEntry = { name: frow.original_name, found: false, extracted: false, empty: false, error: null, warning: null };
      const absPath = path.join(POOL_BASE, frow.file_path);
      if (fs.existsSync(absPath)) {
        statusEntry.found = true;
        try {
          const ext = path.extname(frow.original_name).slice(1).toLowerCase();
          const extracted = await getCachedOrExtractFileText(frow, absPath, ext, extractText);
          statusEntry.extracted = extracted.extracted;
          statusEntry.empty = extracted.empty;
          statusEntry.error = extracted.error || null;
          statusEntry.warning = extracted.warning || null;
          if (extracted && extracted.type === 'text' && extracted.content && extracted.content.trim()) {
            poolTexts.push('--- 文件：' + frow.original_name + ' ---\n' + extracted.content);
            statusEntry.contentLength = extracted.content.length;
          } else if (extracted.warning) {
            console.warn('[poolText] extraction warning: ' + frow.original_name + ' — ' + extracted.warning);
          }
        } catch (ex) {
          statusEntry.extracted = false;
          statusEntry.error = ex.message;
          console.warn('[poolText] failed to extract pool file: ' + frow.original_name + ' — ' + ex.message);
        }
      } else {
        statusEntry.error = 'File not found on disk';
        console.warn('[poolText] pool file not found: ' + frow.original_name + ' at ' + absPath);
      }
      poolFilesStatus.push(statusEntry);
    }

    if (poolTexts.length > 0) {
      userText = poolTexts.join('\n\n') + (userText ? '\n\n' + userText : '');
      console.log('[poolText] merged ' + poolTexts.length + ' pool file(s) for chapter ' + chapterId + ', total textLen=' + userText.length);
    } else if (poolFilesStatus.length > 0) {
      const failReasons = poolFilesStatus
        .map((s) => s.name + ': ' + (s.error || (s.found ? 'empty content' : 'file missing')))
        .join('; ');
      console.error('[poolText] ALL ' + poolFilesStatus.length + ' pool file(s) failed extraction — ' + failReasons);
    }
  } catch (e) {
    console.warn('[poolText] pool file reading failed:', e.message);
  }
  return { text: userText, poolFilesStatus };
}

module.exports = { loadPoolTextForChapter };
