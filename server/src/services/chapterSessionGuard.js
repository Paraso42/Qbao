'use strict';

// 章节出题前规则校验（v3.28）：
// 1. 章节存在未完成（in_progress）且仍有未答题目的会话 → 禁止再次出题（409）。
// 2. 空题会话（questions=[]）视为无效垃圾数据 → 顺手清理，避免"有未做完却进不去答题界面"。

const { pool } = require('../db');
const { ApiError } = require('../lib/errorHandler');

function countAnswered(userAnswers) {
  if (!Array.isArray(userAnswers)) return 0;
  return userAnswers.filter((a) => a !== undefined && a !== null && a !== -1).length;
}

async function assertChapterCanGenerate(userId, chapterId) {
  if (!chapterId) return;
  const result = await pool.query(
    `SELECT id, questions, user_answers FROM answer_sessions
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