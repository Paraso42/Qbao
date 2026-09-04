'use strict';

// 同章节生成互斥锁（round6）
// 背景：一次点击出一轮。此前仅 ai_tasks 表内互斥（同章节 queued/running → 409），
// 而直连路径（/api/v1/ai/generate）与任务路径互不感知：旧版/多端实例会把云端合并
// 来的 pending 任务再用直连生成一遍 → 一次点击出现两轮（实测 17:00:00 任务 +
// 17:00:19 直连，两轮内容不同）。
// 方案：直连路径与任务路径共用 ai_generation_locks（唯一 user_id+chapter_id）：
//  · 直连路径：请求期间持锁，finally 释放（失败/取消同样释放）；
//  · 任务路径：createAiTask 抢锁成功才落库任务，锁随任务终态（完成/失败/取消/启动清理）释放；
//  · 老化兜底：抢锁前清理超 1 小时的孤儿锁（服务崩溃残留）；服务启动时全量清空。
const { pool } = require('../db');
const { ApiError } = require('../lib/errorHandler');

const CONFLICT_MESSAGE = '该章节已有题目正在生成中，请等待完成后再试';
const STALE_WHERE = "created_at < NOW() - INTERVAL '1 hour'";

/**
 * 抢锁。成功返回 release()（幂等，可多次调用）；冲突抛 409。
 * chapterId 为空（如大考卷生成）不参与章节互斥，返回 null。
 */
async function acquireChapterGenerationLock(userId, chapterId, source = 'direct') {
  if (!chapterId) return null;
  await pool.query(
    'DELETE FROM ai_generation_locks WHERE user_id = $1 AND chapter_id = $2 AND ' + STALE_WHERE,
    [userId, chapterId]
  );
  const r = await pool.query(
    'INSERT INTO ai_generation_locks (user_id, chapter_id, source) VALUES ($1, $2, $3) ' +
    'ON CONFLICT (user_id, chapter_id) DO NOTHING RETURNING id',
    [userId, chapterId, source]
  );
  if (!r.rows || r.rows.length === 0) {
    throw new ApiError(409, CONFLICT_MESSAGE);
  }
  return async function release() {
    try {
      await pool.query(
        'DELETE FROM ai_generation_locks WHERE user_id = $1 AND chapter_id = $2',
        [userId, chapterId]
      );
    } catch (e) {
      console.warn('[gen-lock] release failed: ' + e.message);
    }
  };
}

async function releaseChapterGenerationLock(userId, chapterId) {
  if (!chapterId) return;
  try {
    await pool.query(
      'DELETE FROM ai_generation_locks WHERE user_id = $1 AND chapter_id = $2',
      [userId, chapterId]
    );
  } catch (e) {
    console.warn('[gen-lock] release failed: ' + e.message);
  }
}

// 服务启动：进程重启后所有在途直连生成必然已中断，锁全部作废
async function sweepChapterGenerationLocks() {
  try {
    await pool.query('DELETE FROM ai_generation_locks');
  } catch (e) {
    console.warn('[gen-lock] sweep failed: ' + e.message);
  }
}

module.exports = {
  CONFLICT_MESSAGE,
  acquireChapterGenerationLock,
  releaseChapterGenerationLock,
  sweepChapterGenerationLocks,
};
