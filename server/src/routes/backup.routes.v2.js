'use strict';

const { pool } = require('../db');
const { requireAuth } = require('../middleware');
const { asyncHandler, ApiError } = require('../lib/errorHandler');
const { validate } = require('../lib/validate');
const { sanitizeStateJson } = require('../lib/aiStateSanitizer');
const { createBackupSchema, backupIdParamsSchema } = require('../schemas/backup.schema');

module.exports = function (app) {
  app.post('/api/v1/backup', validate({ body: createBackupSchema }), requireAuth, asyncHandler(async (req, res) => {
    const r = await pool.query('SELECT state_json FROM user_data WHERE user_id = $1', [req.userId]);
    const rawState = r.rows.length > 0 ? r.rows[0].state_json : {};
    const state = sanitizeStateJson(rawState);

    const label = (req.body.label || '').trim() || ('备份_' + new Date().toISOString().slice(0, 10));
    const result = await pool.query(
      'INSERT INTO backups (user_id, label, state_json) VALUES ($1, $2, $3) RETURNING id, label, created_at',
      [req.userId, label, state]
    );
    res.status(201).json(result.rows[0]);
  }));

  app.get('/api/v1/backup', requireAuth, asyncHandler(async (req, res) => {
    const r = await pool.query(
      'SELECT id, label, created_at FROM backups WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
      [req.userId]
    );
    res.json(r.rows);
  }));

  app.get('/api/v1/backup/:id', validate({ params: backupIdParamsSchema }), requireAuth, asyncHandler(async (req, res) => {
    const r = await pool.query(
      'SELECT state_json, label, created_at FROM backups WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );
    if (r.rows.length === 0) throw new ApiError(404, '备份不存在');

    const row = r.rows[0];
    row.state_json = sanitizeStateJson(row.state_json);
    res.json(row);
  }));

  app.delete('/api/v1/backup/:id', validate({ params: backupIdParamsSchema }), requireAuth, asyncHandler(async (req, res) => {
    const r = await pool.query(
      'DELETE FROM backups WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.userId]
    );
    if (r.rows.length === 0) throw new ApiError(404, '备份不存在');
    res.json({ ok: true });
  }));
};
