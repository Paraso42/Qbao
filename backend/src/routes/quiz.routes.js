const { pool } = require('../db');
const { requireAuth } = require('../middleware');

module.exports = function (app) {
  // POST /api/v1/quiz/session — create or update answer session (upsert by user+chapter)
  app.post('/api/v1/quiz/session', requireAuth, async (req, res) => {
    try {
      const { chapterId, sessionName, questions, userAnswers, stats } = req.body;
      if (!chapterId) return res.status(422).json({ error: '缺少 chapterId' });

      const result = await pool.query(
        `INSERT INTO answer_sessions (user_id, chapter_id, session_name, questions, user_answers, stats)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb)
         ON CONFLICT (user_id, chapter_id)
         DO UPDATE SET session_name = $3, questions = $4::jsonb, user_answers = $5::jsonb,
           stats = $6::jsonb, updated_at = NOW()
         RETURNING id, chapter_id, session_name, questions, user_answers, stats, created_at, updated_at`,
        [req.userId, chapterId, sessionName || '', JSON.stringify(questions || []), JSON.stringify(userAnswers || []), JSON.stringify(stats || {})]
      );

      const row = result.rows[0];
      res.json({
        session: {
          id: row.id, chapterId: row.chapter_id,
          sessionName: row.session_name,
          questions: row.questions, userAnswers: row.user_answers,
          stats: row.stats, createdAt: row.created_at, updatedAt: row.updated_at
        }
      });
    } catch (e) {
      console.error('quiz session upsert error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/v1/quiz/sessions — list all sessions for current user (lightweight)
  app.get('/api/v1/quiz/sessions', requireAuth, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, chapter_id, session_name,
          jsonb_array_length(questions) AS question_count,
          COALESCE((SELECT COUNT(*) FROM jsonb_array_elements_text(user_answers) WHERE value != 'null'), 0) AS answered_count,
          created_at, updated_at
         FROM answer_sessions WHERE user_id = $1 ORDER BY updated_at DESC`,
        [req.userId]
      );
      res.json({ sessions: result.rows.map(r => ({
        id: r.id, chapterId: r.chapter_id, sessionName: r.session_name,
        questionCount: parseInt(r.question_count), answeredCount: parseInt(r.answered_count),
        createdAt: r.created_at, updatedAt: r.updated_at
      })) });
    } catch (e) {
      console.error('quiz sessions list error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/v1/quiz/session/:id — full session detail
  app.get('/api/v1/quiz/session/:id', requireAuth, async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT * FROM answer_sessions WHERE id = $1 AND user_id = $2',
        [parseInt(req.params.id), req.userId]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: '会话不存在' });
      const row = result.rows[0];
      res.json({
        session: {
          id: row.id, chapterId: row.chapter_id, sessionName: row.session_name,
          questions: row.questions, userAnswers: row.user_answers,
          stats: row.stats, createdAt: row.created_at, updatedAt: row.updated_at
        }
      });
    } catch (e) {
      console.error('quiz session get error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // DELETE /api/v1/quiz/session/:id
  app.delete('/api/v1/quiz/session/:id', requireAuth, async (req, res) => {
    try {
      const result = await pool.query(
        'DELETE FROM answer_sessions WHERE id = $1 AND user_id = $2 RETURNING id',
        [parseInt(req.params.id), req.userId]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: '会话不存在' });
      res.json({ ok: true });
    } catch (e) {
      console.error('quiz session delete error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });
};
