'use strict';

// 章节出题前规则校验（v3.28）：
// 1. 章节存在未完成（in_progress）且仍有未答题目的会话 → 禁止再次出题（409）。
// 2. 空题会话（questions=[]）视为无效垃圾数据 → 顺手清理，避免"有未做完却进不去答题界面"。

const { pool } = require('../db');
const { ApiError } = require('../lib/errorHandler');
const pointsService = require('./pointsService');

function countAnswered(userAnswers) {
  if (!Array.isArray(userAnswers)) return 0;
  return userAnswers.filter((a) => a !== undefined && a !== null && a !== -1).length;
}

async function assertChapterCanGenerate(userId, chapterId) {
  if (!chapterId) return;
  const result = await pool.query(
    `SELECT id, questions, user_answers, stats FROM answer_sessions
     WHERE user_id = $1 AND chapter_id = $2 AND status = 'in_progress'
     LIMIT 1`,
    [userId, chapterId]
  );
  if (result.rows.length === 0) return;

  const row = result.rows[0];
  const questions = Array.isArray(row.questions) ? row.questions : [];
  const answered = countAnswered(row.user_answers);

  if (questions.length > 0 && answered < questions.length) {
    throw new ApiError(
      409,
      '本章节仍有未做完的题目（已答 ' + answered + '/' + questions.length + ' 题），请先完成本轮答题'
    );
  }

  // 全部作答却仍为 in_progress（离线答完未结算、结算请求被刷新/断网打断）：
  // 视为完成自动升级，否则“开始出题”会被永久 409 锁死，而客户端已无“进行中”入口可补。
  // 积分按会话快照正确数增量结算（幂等：快照只前进，客户端后续补发的 completed
  // 会计入剩余增量，不会重复发放）。
  if (questions.length > 0) {
    await pool.query(
      "UPDATE answer_sessions SET status = 'completed', updated_at = NOW() WHERE id = $1 AND status = 'in_progress'",
      [row.id]
    );
    try {
      await pointsService.awardQuizCompletion(pool, userId, chapterId, row.stats);
    } catch (e) {
      console.warn('[chapter-guard] auto-complete award failed:', e.message);
    }
    console.log(
      '[chapter-guard] auto-completed fully-answered session id=' + row.id +
      ' userId=' + userId + ' chapterId=' + chapterId
    );
    return;
  }

  // 空题会话：无实际题目，属于无效数据 → 删除，防止答题入口被锁死（K3）
  if (questions.length === 0) {
    await pool.query('DELETE FROM answer_sessions WHERE id = $1', [row.id]);
    console.log(
      '[chapter-guard] removed empty in_progress session id=' + row.id +
      ' userId=' + userId + ' chapterId=' + chapterId
    );
  }
}

module.exports = { assertChapterCanGenerate };