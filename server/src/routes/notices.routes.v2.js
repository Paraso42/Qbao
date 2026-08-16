'use strict';

const { pool } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware');
const { asyncHandler, ApiError } = require('../lib/errorHandler');
const { validate } = require('../lib/validate');
const {
  noticeIdParamsSchema,
  createNoticeSchema,
  updateNoticeSchema,
  sortNoticesSchema,
} = require('../schemas/notices.schema');

function parseExpireAt(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ApiError(422, 'expire_at 不是合法日期');
  return date;
}

module.exports = function (app) {
  app.get('/api/v1/notices', asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT id, content, type, link, sort_order, duration
       FROM notices
       WHERE enabled = true AND (expire_at IS NULL OR expire_at > now())
       ORDER BY sort_order ASC, id ASC`
    );
    res.json(result.rows);
  }));

  app.get('/api/v1/notices/all', requireAdmin, asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT n.id, n.content, n.type, n.link, n.enabled, n.sort_order,
              n.expire_at, n.created_at, n.updated_at, n.duration,
              u.username AS created_by_name
       FROM notices n
       LEFT JOIN users u ON n.created_by = u.id
       ORDER BY n.sort_order ASC, n.id ASC`
    );
    res.json(result.rows);
  }));

  app.post('/api/v1/notices', validate({ body: createNoticeSchema }), requireAdmin, asyncHandler(async (req, res) => {
    const { content, type, link, expire_at, duration } = req.body;
    const result = await pool.query(
      `INSERT INTO notices (content, type, link, expire_at, created_by, duration)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, content, type, link, enabled, sort_order, expire_at, created_at, duration`,
      [content.trim(), type || 'notice', link || null, parseExpireAt(expire_at), req.userId, duration || 4000]
    );
    res.status(201).json(result.rows[0]);
  }));

  app.put('/api/v1/notices/:id', validate({ params: noticeIdParamsSchema, body: updateNoticeSchema }), requireAdmin, asyncHandler(async (req, res) => {
    const existing = await pool.query('SELECT * FROM notices WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) throw new ApiError(404, '消息不存在');

    const old = existing.rows[0];
    const content = req.body.content !== undefined ? req.body.content.trim() : old.content;
    if (!content) throw new ApiError(422, '内容不能为空');

    const result = await pool.query(
      `UPDATE notices
       SET content = $1, type = $2, link = $3, expire_at = $4, duration = $5, updated_at = now()
       WHERE id = $6
       RETURNING id, content, type, link, enabled, sort_order, expire_at, updated_at, duration`,
      [
        content,
        req.body.type || old.type,
        req.body.link !== undefined ? req.body.link : old.link,
        req.body.expire_at !== undefined ? parseExpireAt(req.body.expire_at) : old.expire_at,
        req.body.duration !== undefined ? req.body.duration : (old.duration || 4000),
        req.params.id,
      ]
    );
    res.json(result.rows[0]);
  }));

  app.delete('/api/v1/notices/:id', validate({ params: noticeIdParamsSchema }), requireAdmin, asyncHandler(async (req, res) => {
    const result = await pool.query('DELETE FROM notices WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) throw new ApiError(404, '消息不存在');
    res.json({ deleted: true });
  }));

  app.patch('/api/v1/notices/:id/toggle', validate({ params: noticeIdParamsSchema }), requireAdmin, asyncHandler(async (req, res) => {
    const result = await pool.query(
      'UPDATE notices SET enabled = NOT enabled, updated_at = now() WHERE id = $1 RETURNING id, enabled',
      [req.params.id]
    );
    if (result.rows.length === 0) throw new ApiError(404, '消息不存在');
    res.json(result.rows[0]);
  }));

  app.put('/api/v1/notices/sort', validate({ body: sortNoticesSchema }), requireAdmin, asyncHandler(async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const item of req.body.items) {
        await client.query(
          'UPDATE notices SET sort_order = $1, updated_at = now() WHERE id = $2',
          [item.sort_order, item.id]
        );
      }
      await client.query('COMMIT');
      res.json({ success: true });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }));
};
