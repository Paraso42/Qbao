'use strict';

const { pool } = require('../db');
const { requireAuth } = require('../middleware');
const { asyncHandler, ApiError } = require('../lib/errorHandler');
const { validate } = require('../lib/validate');
const { putDataSchema, patchSectionSchema } = require('../schemas/data.schema');
const { sanitizeStateJson, sanitizeAiConfigObject } = require('../lib/aiStateSanitizer');

// v3.25: 乐观锁（rev）— 桌面/网页多端互通防覆盖。
// 客户端 PUT/PATCH 可带 rev；不匹配返回 409 { error, current }。
// T13: 不带 rev 的 PUT 仅允许首写（服务器无该用户数据时）；
//      已有数据时返回 409，杜绝旧客户端/裸写覆盖云端新数据。

async function getRow(userId) {
  const r = await pool.query('SELECT state_json, synced_at, rev FROM user_data WHERE user_id = $1', [userId]);
  const row = r.rows.length ? r.rows[0] : null;
  if (row) row.state_json = sanitizeStateJson(row.state_json);
  return row;
}

function validRev(v) {
  return (typeof v === 'number' && Number.isInteger(v) && v > 0) ? v : null;
}

module.exports = function (app) {
  // GET /api/v1/data
  app.get('/api/v1/data', requireAuth, asyncHandler(async (req, res) => {
    const row = await getRow(req.userId);
    if (!row) return res.json({ state_json: {}, synced_at: null, rev: 1 });
    res.json({ state_json: row.state_json, synced_at: row.synced_at, rev: row.rev });
  }));

  // GET /api/v1/data/rev — 轻量版本号轮询（客户端 20s 轮询用，避免全量传输）
  app.get('/api/v1/data/rev', requireAuth, asyncHandler(async (req, res) => {
    const r = await pool.query('SELECT rev, synced_at FROM user_data WHERE user_id = $1', [req.userId]);
    if (r.rows.length === 0) return res.json({ rev: 1, synced_at: null });
    res.json({ rev: r.rows[0].rev, synced_at: r.rows[0].synced_at });
  }));

  // PUT /api/v1/data — 全量写入，可选乐观锁（校验先于鉴权：畸形请求直接 422）
  app.put('/api/v1/data', validate({ body: putDataSchema }), requireAuth, asyncHandler(async (req, res) => {
      // state_json 已在解构处完成 AI Key 脱敏。
    const { rev } = req.body;
      const state_json = sanitizeStateJson(req.body.state_json);
    const clientRev = validRev(rev);
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
      throw new ApiError(409, '数据版本冲突', { current: { state_json: cur.state_json, synced_at: cur.synced_at, rev: cur.rev } });
    }
    // T13: 无 rev 保护 — 仅允许首写（服务器无行）；已有行 → 409，要求客户端升级/带 rev 重试。
    // 用 INSERT ... ON CONFLICT DO NOTHING 原子判定：成功即首写；冲突说明已有数据。
    const ins = await pool.query(
      'INSERT INTO user_data (user_id, state_json) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING RETURNING rev',
      [req.userId, state_json]
    );
    if (ins.rows.length) return res.json({ ok: true, rev: ins.rows[0].rev });
    const cur = await getRow(req.userId);
    throw new ApiError(409, '数据版本冲突：客户端未携带 rev（版本过旧），请升级后重试', {
      current: { state_json: cur.state_json, synced_at: cur.synced_at, rev: cur.rev },
    });
  }));

  // PATCH /api/v1/data/section — 部分更新（乐观锁 CAS）
  app.patch('/api/v1/data/section', validate({ body: patchSectionSchema }), requireAuth, asyncHandler(async (req, res) => {
      var safeData = null;
    const { section, data, rev } = req.body;
      safeData = section === 'aiConfig' ? sanitizeAiConfigObject(data) : data;
    const row = await getRow(req.userId);
    if (!row) {
      // 首写：构造只有该 section 的状态
      const st = {}; st[section] = safeData;
      const r = await pool.query(
        'INSERT INTO user_data (user_id, state_json, rev) VALUES ($1, $2, 1) ON CONFLICT (user_id) DO NOTHING RETURNING rev',
        [req.userId, st]
      );
      const newRev = r.rows.length ? r.rows[0].rev : 1;
      return res.json({ ok: true, rev: newRev });
    }
    // 客户端显式带 rev 且与当前不符 → 提前 409
    const clientRev = validRev(rev);
    if (clientRev && clientRev !== row.rev) {
      throw new ApiError(409, '数据版本冲突', { current: { state_json: row.state_json, synced_at: row.synced_at, rev: row.rev } });
    }
    const state = row.state_json || {};
    state[section] = { ...(state[section] || {}), ...safeData };
      const safeState = sanitizeStateJson(state);
    const upd = await pool.query(
      'UPDATE user_data SET state_json = $2, rev = rev + 1, synced_at = NOW() WHERE user_id = $1 AND rev = $3 RETURNING rev',
      [req.userId, safeState, row.rev]
    );
    if (upd.rows.length) return res.json({ ok: true, rev: upd.rows[0].rev });
    const cur = await getRow(req.userId);
    throw new ApiError(409, '数据版本冲突', { current: { state_json: cur.state_json, synced_at: cur.synced_at, rev: cur.rev } });
  }));
};