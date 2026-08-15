'use strict';

const { pool } = require('../db');
const { requireAuth } = require('../middleware');
const { asyncHandler, ApiError } = require('../lib/errorHandler');
const { validate } = require('../lib/validate');
const { postSessionSchema, listSessionsQuerySchema, idParamsSchema } = require('../schemas/quiz.schema');

function formatSession(row) {
  return {
    id: row.id, chapterId: row.chapter_id, subjectId: row.subject_id,
    sessionName: row.session_name, status: row.status,
    questions: row.questions, userAnswers: row.user_answers,
    stats: row.stats, createdAt: row.created_at, updatedAt: row.updated_at
  };
}

module.exports = function (app) {
  // POST /api/v1/quiz/session — create or update answer session
  app.post('/api/v1/quiz/session', validate({ body: postSessionSchema }), requireAuth, asyncHandler(async (req, res) => {
    const { chapterId, subjectId, setId, sessionName, questions, userAnswers, stats, status } = req.body;
    const newStatus = status || 'in_progress';

    // 完成：找到 in_progress 会话并更新为 completed
    if (newStatus === 'completed') {
      const existingRes = await pool.query(
        'SELECT id, status FROM answer_sessions WHERE user_id = $1 AND chapter_id = $2 AND status = \'in_progress\'',
        [req.userId, chapterId]
      );
      if (existingRes.rows.length > 0) {
        const row = existingRes.rows[0];
        const updRes = await pool.query(
          'UPDATE answer_sessions SET status = \'completed\', questions = $1::jsonb, user_answers = $2::jsonb, stats = $3::jsonb, updated_at = NOW() WHERE id = $4 RETURNING id, chapter_id, subject_id, session_name, questions, user_answers, stats, status, created_at, updated_at',
          [JSON.stringify(questions || []), JSON.stringify(userAnswers || []), JSON.stringify(stats || {}), row.id]
        );
        return res.json({ session: formatSession(updRes.rows[0]) });
      }
      // 无 in_progress 会话可完成 — 直接以 completed 建
      const compResult = await pool.query(
        'INSERT INTO answer_sessions (user_id, chapter_id, subject_id, session_name, questions, user_answers, stats, status) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, \'completed\') ON CONFLICT (user_id, chapter_id) DO UPDATE SET subject_id = $3, session_name = $4, questions = $5::jsonb, user_answers = $6::jsonb, stats = $7::jsonb, status = \'completed\', updated_at = NOW() RETURNING *',
        [req.userId, chapterId, subjectId || null, sessionName || '',
         JSON.stringify(questions || []), JSON.stringify(userAnswers || []), JSON.stringify(stats || {})]
      );
      return res.json({ session: formatSession(compResult.rows[0]) });
    }

    // in_progress：若已有 completed 会话，则将其重置为新一轮 in_progress
    const checkRes = await pool.query(
      'SELECT id, status FROM answer_sessions WHERE user_id = $1 AND chapter_id = $2 AND status = \'completed\'',
      [req.userId, chapterId]
    );
    if (checkRes.rows.length > 0) {
      const completedId = checkRes.rows[0].id;
      await pool.query(
        'UPDATE answer_sessions SET status = \'in_progress\', session_name = $1, questions = $2::jsonb, user_answers = $3::jsonb, stats = $4::jsonb, subject_id = $5, updated_at = NOW() WHERE id = $6',
        [sessionName || '', JSON.stringify(questions || []), JSON.stringify(userAnswers || []),
         JSON.stringify(stats || {}), subjectId || null, completedId]
      );
      const fres = await pool.query('SELECT * FROM answer_sessions WHERE id = $1', [completedId]);
      return res.json({ session: formatSession(fres.rows[0]) });
    }

    // 常规 upsert（user_id + chapter_id 唯一）
    const result = await pool.query(
      'INSERT INTO answer_sessions (user_id, chapter_id, subject_id, session_name, questions, user_answers, stats, status) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, \'in_progress\') ON CONFLICT (user_id, chapter_id) DO UPDATE SET subject_id = $3, session_name = $4, questions = $5::jsonb, user_answers = $6::jsonb, stats = $7::jsonb, status = \'in_progress\', updated_at = NOW() RETURNING *',
      [req.userId, chapterId, subjectId || null, sessionName || '',
       JSON.stringify(questions || []), JSON.stringify(userAnswers || []), JSON.stringify(stats || {})]
    );
    res.json({ session: formatSession(result.rows[0]) });
  }));

  // GET /api/v1/quiz/sessions — 当前用户的会话列表
  app.get('/api/v1/quiz/sessions', validate({ query: listSessionsQuerySchema }), requireAuth, asyncHandler(async (req, res) => {
    let sql = 'SELECT id, chapter_id, subject_id, session_name, status,'
      + ' jsonb_array_length(questions) AS question_count,'
      + ' COALESCE((SELECT COUNT(*) FROM jsonb_array_elements_text(user_answers) WHERE value != \'null\'), 0) AS answered_count,'
      + ' created_at, updated_at'
      + ' FROM answer_sessions WHERE user_id = $1';
    const params = [req.userId];

    if (req.query.status) {
      params.push(req.query.status);
      sql += ' AND status = $' + params.length;
    }
    sql += ' ORDER BY updated_at DESC';

    const result = await pool.query(sql, params);
    res.json({ sessions: result.rows.map(function (r) {
      return {
        id: r.id, chapterId: r.chapter_id, subjectId: r.subject_id,
        sessionName: r.session_name, status: r.status,
        questionCount: parseInt(r.question_count), answeredCount: parseInt(r.answered_count),
        createdAt: r.created_at, updatedAt: r.updated_at
      };
    })});
  }));

  // GET /api/v1/quiz/session/:id — 会话详情
  app.get('/api/v1/quiz/session/:id', validate({ params: idParamsSchema }), requireAuth, asyncHandler(async (req, res) => {
    const result = await pool.query(
      'SELECT * FROM answer_sessions WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );
    if (result.rows.length === 0) throw new ApiError(404, '会话不存在');
    res.json({ session: formatSession(result.rows[0]) });
  }));

  // DELETE /api/v1/quiz/session/:id
  app.delete('/api/v1/quiz/session/:id', validate({ params: idParamsSchema }), requireAuth, asyncHandler(async (req, res) => {
    const result = await pool.query(
      'DELETE FROM answer_sessions WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.userId]
    );
    if (result.rows.length === 0) throw new ApiError(404, '会话不存在');
    res.json({ ok: true });
  }));
};
