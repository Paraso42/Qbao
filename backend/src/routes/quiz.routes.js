const { pool } = require('../db');
const { requireAuth } = require('../middleware');

module.exports = function (app) {
  // POST /api/v1/quiz/session — create or update answer session
  app.post('/api/v1/quiz/session', requireAuth, async (req, res) => {
    try {
      const { chapterId, subjectId, setId, sessionName, questions, userAnswers, stats, status } = req.body;
      if (!chapterId) return res.status(422).json({ error: '缺少 chapterId' });

      var newStatus = status || 'in_progress';

      // If completing: find the in_progress session and update it to completed
      if (newStatus === 'completed') {
        var existingRes = await pool.query(
          'SELECT id, status FROM answer_sessions WHERE user_id = $1 AND chapter_id = $2 AND status = \'in_progress\'',
          [req.userId, chapterId]
        );
        if (existingRes.rows.length > 0) {
          // Update the in_progress session to completed (lock it)
          var row = existingRes.rows[0];
          var updRes = await pool.query(
            `UPDATE answer_sessions SET status = 'completed', questions = $1::jsonb, user_answers = $2::jsonb,
               stats = $3::jsonb, updated_at = NOW()
             WHERE id = $4 RETURNING id, chapter_id, subject_id, session_name, questions, user_answers, stats, status, created_at, updated_at`,
            [JSON.stringify(questions || []), JSON.stringify(userAnswers || []), JSON.stringify(stats || {}), row.id]
          );
          var u = updRes.rows[0];
          return res.json({ session: formatSession(u) });
        }
        // No in_progress session to complete — create directly as completed
        var compResult = await pool.query(
          `INSERT INTO answer_sessions (user_id, chapter_id, subject_id, session_name, questions, user_answers, stats, status)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, 'completed')
           ON CONFLICT (user_id, chapter_id)
           DO UPDATE SET subject_id = $3, session_name = $4, questions = $5::jsonb, user_answers = $6::jsonb,
             stats = $7::jsonb, status = 'completed', updated_at = NOW()
           RETURNING *`,
          [req.userId, chapterId, subjectId || null, sessionName || '',
           JSON.stringify(questions || []), JSON.stringify(userAnswers || []), JSON.stringify(stats || {})]
        );
        return res.json({ session: formatSession(compResult.rows[0]) });
      }

      // For in_progress: upsert (only if not already completed)
      var checkRes = await pool.query(
        'SELECT id, status FROM answer_sessions WHERE user_id = $1 AND chapter_id = $2 AND status = \'completed\'',
        [req.userId, chapterId]
      );
      if (checkRes.rows.length > 0 && newStatus === 'in_progress') {
        // There's a completed session for this chapter, update it to in_progress (new round)
        var completedId = checkRes.rows[0].id;
        await pool.query(
          `UPDATE answer_sessions SET status = 'in_progress', session_name = $1, questions = $2::jsonb,
             user_answers = $3::jsonb, stats = $4::jsonb, subject_id = $5, updated_at = NOW()
           WHERE id = $6`,
          [sessionName || '', JSON.stringify(questions || []), JSON.stringify(userAnswers || []),
           JSON.stringify(stats || {}), subjectId || null, completedId]
        );
        var fres = await pool.query('SELECT * FROM answer_sessions WHERE id = $1', [completedId]);
        return res.json({ session: formatSession(fres.rows[0]) });
      }

      // Normal upsert by user_id + chapter_id (only affects in_progress or new)
      var result = await pool.query(
        `INSERT INTO answer_sessions (user_id, chapter_id, subject_id, session_name, questions, user_answers, stats, status)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, 'in_progress')
         ON CONFLICT (user_id, chapter_id)
         DO UPDATE SET subject_id = $3, session_name = $4, questions = $5::jsonb, user_answers = $6::jsonb,
           stats = $7::jsonb, status = 'in_progress', updated_at = NOW()
         RETURNING *`,
        [req.userId, chapterId, subjectId || null, sessionName || '',
         JSON.stringify(questions || []), JSON.stringify(userAnswers || []), JSON.stringify(stats || {})]
      );

      res.json({ session: formatSession(result.rows[0]) });
    } catch (e) {
      console.error('quiz session upsert error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/v1/quiz/sessions — list sessions for current user
  app.get('/api/v1/quiz/sessions', requireAuth, async (req, res) => {
    try {
      var sql = 'SELECT id, chapter_id, subject_id, session_name, status,'
        + ' jsonb_array_length(questions) AS question_count,'
        + ' COALESCE((SELECT COUNT(*) FROM jsonb_array_elements_text(user_answers) WHERE value != \'null\'), 0) AS answered_count,'
        + ' created_at, updated_at'
        + ' FROM answer_sessions WHERE user_id = $1';
      var params = [req.userId];

      if (req.query.status) {
        params.push(req.query.status);
        sql += ' AND status = $' + params.length;
      }
      sql += ' ORDER BY updated_at DESC';

      var result = await pool.query(sql, params);
      res.json({ sessions: result.rows.map(function(r) {
        return {
          id: r.id, chapterId: r.chapter_id, subjectId: r.subject_id,
          sessionName: r.session_name, status: r.status,
          questionCount: parseInt(r.question_count), answeredCount: parseInt(r.answered_count),
          createdAt: r.created_at, updatedAt: r.updated_at
        };
      })});
    } catch (e) {
      console.error('quiz sessions list error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/v1/quiz/session/:id — full session detail
  app.get('/api/v1/quiz/session/:id', requireAuth, async (req, res) => {
    try {
      var result = await pool.query(
        'SELECT * FROM answer_sessions WHERE id = $1 AND user_id = $2',
        [parseInt(req.params.id), req.userId]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: '会话不存在' });
      res.json({ session: formatSession(result.rows[0]) });
    } catch (e) {
      console.error('quiz session get error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // DELETE /api/v1/quiz/session/:id
  app.delete('/api/v1/quiz/session/:id', requireAuth, async (req, res) => {
    try {
      var result = await pool.query(
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

function formatSession(row) {
  return {
    id: row.id, chapterId: row.chapter_id, subjectId: row.subject_id,
    sessionName: row.session_name, status: row.status,
    questions: row.questions, userAnswers: row.user_answers,
    stats: row.stats, createdAt: row.created_at, updatedAt: row.updated_at
  };
}
