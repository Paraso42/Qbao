const { pool } = require('../db');
const { requireAuth } = require('../middleware');

// v3.25: 乐观锁（rev）— 桌面/网页多端互通防覆盖。
// 客户端 PUT/PATCH 可带 rev；不匹配返回 409 { error, current }。
// 旧客户端不带 rev 时保持原有覆盖行为（灰度兼容）。

async function getRow(userId) {
  const r = await pool.query('SELECT state_json, synced_at, rev FROM user_data WHERE user_id = $1', [userId]);
  return r.rows.length ? r.rows[0] : null;
}

function validRev(v) {
  return (typeof v === 'number' && Number.isInteger(v) && v > 0) ? v : null;
}

module.exports = function (app) {
  // GET /api/v1/data
  app.get('/api/v1/data', requireAuth, async (req, res) => {
    try {
      const row = await getRow(req.userId);
      if (!row) return res.json({ state_json: {}, synced_at: null, rev: 1 });
      res.json({ state_json: row.state_json, synced_at: row.synced_at, rev: row.rev });
    } catch (e) {
      console.error('[data] GET error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // PUT /api/v1/data — 全量写入，可选乐观锁
  app.put('/api/v1/data', requireAuth, async (req, res) => {
    try {
      const body = req.body || {};
      const state_json = body.state_json;
      if (state_json === undefined || state_json === null) {
        return res.status(422).json({ error: 'state_json 必填' });
      }
      const clientRev = validRev(body.rev);
      if (clientRev) {
        // 乐观锁路径：原子条件更新
        const upd = await pool.query(
          'UPDATE user_data SET state_json = $2, rev = rev + 1, synced_at = NOW() WHERE user_id = $1 AND rev = $3 RETURNING rev',
          [req.userId, state_json, clientRev]
        );
        if (upd.rows.length) return res.json({ ok: true, rev: upd.rows[0].rev });
        const cur = await getRow(req.userId);
        if (!cur) {
          // 首写：按客户端预期 rev=1 插入
          await pool.query(
            'INSERT INTO user_data (user_id, state_json, rev) VALUES ($1, $2, 1) ON CONFLICT (user_id) DO NOTHING',
            [req.userId, state_json]
          );
          return res.json({ ok: true, rev: 1 });
        }
        return res.status(409).json({ error: '数据版本冲突', current: { state_json: cur.state_json, synced_at: cur.synced_at, rev: cur.rev } });
      }
      // 兼容路径：旧客户端全量覆盖（rev 自增）
      const r = await pool.query(
        'INSERT INTO user_data (user_id, state_json) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET state_json = EXCLUDED.state_json, rev = user_data.rev + 1, synced_at = NOW() RETURNING rev',
        [req.userId, state_json]
      );
      res.json({ ok: true, rev: r.rows[0].rev });
    } catch (e) {
      console.error('[data] PUT error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // PATCH /api/v1/data/section — 部分更新（乐观锁 CAS）
  app.patch('/api/v1/data/section', requireAuth, async (req, res) => {
    try {
      const body = req.body || {};
      const { section, data } = body;
      if (!section || !data) return res.status(422).json({ error: 'section 和 data 必填' });
      const row = await getRow(req.userId);
      if (!row) {
        // 首写：构造只有该 section 的状态
        const st = {}; st[section] = data;
        const r = await pool.query(
          'INSERT INTO user_data (user_id, state_json, rev) VALUES ($1, $2, 1) ON CONFLICT (user_id) DO NOTHING RETURNING rev',
          [req.userId, st]
        );
        const rev = r.rows.length ? r.rows[0].rev : 1;
        return res.json({ ok: true, rev });
      }
      // 客户端显式带 rev 且与当前不符 → 提前 409
      const clientRev = validRev(body.rev);
      if (clientRev && clientRev !== row.rev) {
        return res.status(409).json({ error: '数据版本冲突', current: { state_json: row.state_json, synced_at: row.synced_at, rev: row.rev } });
      }
      const state = row.state_json || {};
      state[section] = { ...(state[section] || {}), ...data };
      const upd = await pool.query(
        'UPDATE user_data SET state_json = $2, rev = rev + 1, synced_at = NOW() WHERE user_id = $1 AND rev = $3 RETURNING rev',
        [req.userId, state, row.rev]
      );
      if (upd.rows.length) return res.json({ ok: true, rev: upd.rows[0].rev });
      const cur = await getRow(req.userId);
      return res.status(409).json({ error: '数据版本冲突', current: { state_json: cur.state_json, synced_at: cur.synced_at, rev: cur.rev } });
    } catch (e) {
      console.error('[data] PATCH error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });
};
