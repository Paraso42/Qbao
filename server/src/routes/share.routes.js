const { pool } = require('../db');
const { requireAuth } = require('../middleware');

function genCode() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

module.exports = function (app) {
  app.post('/api/v1/share', requireAuth, async (req, res) => {
    try {
      const { name, questions, password, expiresDays } = req.body;
      if (!name || !questions) return res.status(422).json({ error: 'name 和 questions 必填' });
      let pwHash = null;
      if (password) pwHash = await require('../auth').hashPassword(password);
      let expiresAt = null;
      if (expiresDays) expiresAt = new Date(Date.now() + expiresDays * 86400000);
      const code = genCode();
      await pool.query('INSERT INTO shared_banks (share_code, owner_id, name, questions, password, expires_at) VALUES ($1,$2,$3,$4,$5,$6)', [code, req.userId, name, JSON.stringify(questions), pwHash, expiresAt]);
      res.json({ shareCode: code, url: `/api/v1/share/${code}` });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/v1/share/my', requireAuth, async (req, res) => {
    try {
      const r = await pool.query('SELECT share_code, name, created_at, download_count, expires_at FROM shared_banks WHERE owner_id = $1 ORDER BY created_at DESC', [req.userId]);
      res.json(r.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/v1/share/:code', async (req, res) => {
    try {
      const r = await pool.query('SELECT * FROM shared_banks WHERE share_code = $1', [req.params.code]);
      if (r.rows.length === 0) return res.status(404).json({ error: '分享不存在' });
      const s = r.rows[0];
      if (s.expires_at && s.expires_at < new Date()) return res.status(410).json({ error: '分享已过期' });
      if (s.password) {
        if (!req.query.password) return res.status(403).json({ error: '需要密码' });
        const ok = await require('../auth').comparePassword(req.query.password, s.password);
        if (!ok) return res.status(403).json({ error: '密码错误' });
      }
      await pool.query('UPDATE shared_banks SET download_count = download_count + 1 WHERE id = $1', [s.id]);
      res.json({ name: s.name, questions: s.questions, createdAt: s.created_at });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/v1/share/:code', requireAuth, async (req, res) => {
    try {
      await pool.query('DELETE FROM shared_banks WHERE share_code = $1 AND owner_id = $2', [req.params.code, req.userId]);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
};
