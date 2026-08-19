'use strict';

const crypto = require('crypto');
const { pool } = require('../db');
const { requireAuth } = require('../middleware');
const { hashPassword, comparePassword, verifyToken } = require('../auth');
const pointsService = require('../services/pointsService');
const { asyncHandler, ApiError } = require('../lib/errorHandler');
const { validate } = require('../lib/validate');
const { createShareSchema, shareCodeParamsSchema, sharePasswordQuerySchema } = require('../schemas/share.schema');

function genCode() {
  return crypto.randomBytes(6).toString('base64url').slice(0, 8);
}

async function insertShareWithRetry(userId, payload) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = genCode();
    try {
      const result = await pool.query(
        'INSERT INTO shared_banks (share_code, owner_id, name, questions, password, expires_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING share_code, name, created_at',
        [code, userId, payload.name, JSON.stringify(payload.questions), payload.pwHash, payload.expiresAt]
      );
      return result.rows[0];
    } catch (e) {
      if (e.code === '23505' && attempt < 2) continue;
      throw e;
    }
  }
}

module.exports = function (app) {
  app.post('/api/v1/share', validate({ body: createShareSchema }), requireAuth, asyncHandler(async (req, res) => {
    const { name, questions, password, expiresDays } = req.body;

    const pwHash = password ? await hashPassword(password) : null;
    const expiresAt = expiresDays ? new Date(Date.now() + expiresDays * 86400000) : null;

    const share = await insertShareWithRetry(req.userId, { name, questions, pwHash, expiresAt });
    res.status(201).json({ shareCode: share.share_code, url: `/api/v1/share/${share.share_code}` });
  }));

  app.get('/api/v1/share/my', requireAuth, asyncHandler(async (req, res) => {
    const r = await pool.query(
      'SELECT share_code, name, created_at, download_count, expires_at FROM shared_banks WHERE owner_id = $1 ORDER BY created_at DESC',
      [req.userId]
    );
    res.json(r.rows);
  }));

  app.get('/api/v1/share/:code', validate({ params: shareCodeParamsSchema, query: sharePasswordQuerySchema }), asyncHandler(async (req, res) => {
    const r = await pool.query('SELECT * FROM shared_banks WHERE share_code = $1', [req.params.code]);
    if (r.rows.length === 0) throw new ApiError(404, '分享不存在');

    const s = r.rows[0];
    if (s.expires_at && new Date(s.expires_at) < new Date()) throw new ApiError(410, '分享已过期');

    if (s.password) {
      if (!req.query.password) throw new ApiError(403, '需要密码');
      const ok = await comparePassword(req.query.password, s.password);
      if (!ok) throw new ApiError(403, '密码错误');
    }

    // 可选登录态：有有效 token 时记录下载者（用于分享奖励；分享无需登录仍可下载）
    let downloaderId = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.indexOf('Bearer ') === 0) {
      const decoded = verifyToken(authHeader.slice(7));
      if (decoded) downloaderId = decoded.sub;
    }

    const upd = await pool.query(
      'UPDATE shared_banks SET download_count = download_count + 1 WHERE id = $1 RETURNING download_count',
      [s.id]
    );
    const newCount = parseInt((upd.rows[0] && upd.rows[0].download_count) || 0);

    // 分享奖励：仅登录用户下载他人分享时 +2（单库封顶；失败不阻塞下载）
    if (downloaderId && Number(downloaderId) !== Number(s.owner_id) && newCount > 0) {
      pointsService.awardShareDownload(pool, s.owner_id, s.id, newCount)
        .catch((e) => console.warn('[points] share download award failed:', e.message));
    }

    res.json({ name: s.name, questions: s.questions, createdAt: s.created_at });
  }));

  app.delete('/api/v1/share/:code', validate({ params: shareCodeParamsSchema }), requireAuth, asyncHandler(async (req, res) => {
    const r = await pool.query(
      'DELETE FROM shared_banks WHERE share_code = $1 AND owner_id = $2 RETURNING id',
      [req.params.code, req.userId]
    );
    if (r.rows.length === 0) throw new ApiError(404, '分享不存在');
    res.json({ ok: true });
  }));
};