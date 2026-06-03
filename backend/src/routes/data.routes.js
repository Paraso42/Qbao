const { pool } = require('../db');
const { requireAuth } = require('../middleware');

module.exports = function (app) {
  // GET /api/v1/data
  app.get('/api/v1/data', requireAuth, async (req, res) => {
    try {
      const r = await pool.query('SELECT state_json, synced_at FROM user_data WHERE user_id = $1', [req.userId]);
      if (r.rows.length === 0) {
        return res.json({ state_json: {}, synced_at: null });
      }
      res.json(r.rows[0]);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // PUT /api/v1/data
  app.put('/api/v1/data', requireAuth, async (req, res) => {
    try {
      const { state_json } = req.body;
      if (!state_json && state_json !== {}) return res.status(422).json({ error: 'state_json 必填' });
      await pool.query(
        'INSERT INTO user_data (user_id, state_json) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET state_json = $2, synced_at = NOW()',
        [req.userId, state_json]
      );
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // PATCH /api/v1/data/section
  app.patch('/api/v1/data/section', requireAuth, async (req, res) => {
    try {
      const { section, data } = req.body;
      if (!section || !data) return res.status(422).json({ error: 'section 和 data 必填' });
      const r = await pool.query('SELECT state_json FROM user_data WHERE user_id = $1', [req.userId]);
      let state = {};
      if (r.rows.length > 0) state = r.rows[0].state_json;
      state[section] = { ...state[section], ...data };
      await pool.query(
        'INSERT INTO user_data (user_id, state_json) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET state_json = $2, synced_at = NOW()',
        [req.userId, state]
      );
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
};
