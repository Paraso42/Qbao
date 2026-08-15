const { pool } = require('../db');
const { requireAuth } = require('../middleware');

module.exports = function (app) {
  app.post('/api/v1/backup', requireAuth, async (req, res) => {
    try {
      const { label } = req.body;
      const r = await pool.query('SELECT state_json FROM user_data WHERE user_id = $1', [req.userId]);
      const state = r.rows.length > 0 ? r.rows[0].state_json : {};
      const result = await pool.query(
        'INSERT INTO backups (user_id, label, state_json) VALUES ($1, $2, $3) RETURNING id, label, created_at',
        [req.userId, label || '备份_' + new Date().toISOString().slice(0, 10), state]
      );
      res.json(result.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/v1/backup', requireAuth, async (req, res) => {
    try {
      const r = await pool.query('SELECT id, label, created_at FROM backups WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [req.userId]);
      res.json(r.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/v1/backup/:id', requireAuth, async (req, res) => {
    try {
      const r = await pool.query('SELECT state_json, label, created_at FROM backups WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
      if (r.rows.length === 0) return res.status(404).json({ error: '备份不存在' });
      res.json(r.rows[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/v1/backup/:id', requireAuth, async (req, res) => {
    try {
      await pool.query('DELETE FROM backups WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
};
