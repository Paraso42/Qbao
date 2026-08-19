'use strict';

const { pool } = require('../db');
const { requireAuth } = require('../middleware');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { asyncHandler, ApiError } = require('../lib/errorHandler');
const { validate } = require('../lib/validate');
const {
  listFilesQuerySchema,
  idParamsSchema,
  assignFileBodySchema,
} = require('../schemas/files.schema');
const { cleanupExpiredFiles } = require('../services/filePoolService');
const pointsService = require('../services/pointsService');
const P = require('../config/points');

const UPLOAD_BASE = path.join(__dirname, '../../../uploads/pool');
if (!fs.existsSync(UPLOAD_BASE)) fs.mkdirSync(UPLOAD_BASE, { recursive: true });

const ALLOWED_FILE_EXTS = ['.pdf', '.doc', '.docx', '.pptx', '.txt', '.md'];

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const userDir = path.join(UPLOAD_BASE, String(req.userId));
    if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
    cb(null, userDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, crypto.randomBytes(12).toString('hex') + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!ALLOWED_FILE_EXTS.includes(ext)) {
      const error = new Error('不支持的文件类型：' + (ext || '未知') + '；仅支持 pdf/doc/docx/pptx/txt/md');
      error.status = 422;
      return cb(error);
    }
    cb(null, true);
  },
});

function removeUploadedFile(file) {
  if (file && file.path && fs.existsSync(file.path)) {
    try { fs.unlinkSync(file.path); } catch (_) {}
  }
}

// 过期文件清理统一走 services/filePoolService.js（与 AI 出题读池共用）

function formatFileRow(row) {
  return {
    id: row.id,
    originalName: row.original_name,
    storedName: row.stored_name,
    fileSize: parseInt(row.file_size),
    mimeType: row.mime_type,
    chapterId: row.chapter_id,
    inPool: row.in_pool,
    poolExpiresAt: row.pool_expires_at,
    pointsExtended: row.points_extended,
    createdAt: row.created_at,
  };
}

module.exports = function (app) {
  app.post('/api/v1/files/upload', requireAuth, upload.single('file'), asyncHandler(async (req, res) => {
    if (!req.file) throw new ApiError(422, '未上传文件');

    const userId = req.userId;
    const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const storedName = req.file.filename;
    const fileSize = req.file.size;
    const mimeType = req.file.mimetype || '';
    const chapterId = req.body.chapterId || null;

    const dupCheck = await pool.query(
      `SELECT id FROM user_files
       WHERE user_id = $1 AND original_name = $2 AND file_size = $3
         AND pool_expires_at > NOW()
       LIMIT 1`,
      [userId, originalName, fileSize]
    );
    if (dupCheck.rows.length > 0) {
      removeUploadedFile(req.file);
      throw new ApiError(409, '文件 "' + originalName + '" 已存在于文件池中（名称、大小、格式完全一致），请勿重复上传');
    }

    const relPath = 'pool/' + userId + '/' + storedName;
    const poolExpiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

    try {
      const result = await pool.query(
        `INSERT INTO user_files (user_id, original_name, stored_name, file_size, file_path, mime_type, chapter_id, pool_expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [userId, originalName, storedName, fileSize, relPath, mimeType, chapterId, poolExpiresAt]
      );
      res.status(201).json({ file: formatFileRow(result.rows[0]) });
    } catch (e) {
      removeUploadedFile(req.file);
      throw e;
    }
  }));

  app.get('/api/v1/files', validate({ query: listFilesQuerySchema }), requireAuth, asyncHandler(async (req, res) => {
    await cleanupExpiredFiles(req.userId);

    let sql = 'SELECT * FROM user_files WHERE user_id = $1';
    const params = [req.userId];
    let pi = 1;

    if (req.query.pool === 'true') {
      pi++;
      sql += ' AND in_pool = $' + pi;
      params.push(true);
    }
    if (req.query.chapter_id) {
      pi++;
      sql += ' AND chapter_id = $' + pi;
      params.push(req.query.chapter_id);
    }
    sql += ' ORDER BY created_at DESC';

    const result = await pool.query(sql, params);
    res.json({ files: result.rows.map(formatFileRow) });
  }));

  app.delete('/api/v1/files/:id', validate({ params: idParamsSchema }), requireAuth, asyncHandler(async (req, res) => {
    const result = await pool.query(
      'DELETE FROM user_files WHERE id = $1 AND user_id = $2 RETURNING file_path',
      [req.params.id, req.userId]
    );
    if (result.rows.length === 0) throw new ApiError(404, '文件不存在');

    const absPath = path.join(UPLOAD_BASE, '..', result.rows[0].file_path);
    try { if (fs.existsSync(absPath)) fs.unlinkSync(absPath); } catch (_) {}

    res.json({ ok: true });
  }));

  app.post('/api/v1/files/:id/assign', validate({ params: idParamsSchema, body: assignFileBodySchema }), requireAuth, asyncHandler(async (req, res) => {
    const result = await pool.query(
      'UPDATE user_files SET chapter_id = $1 WHERE id = $2 AND user_id = $3 RETURNING *',
      [req.body.chapterId, req.params.id, req.userId]
    );
    if (result.rows.length === 0) throw new ApiError(404, '文件不存在或不属于你');

    res.json({ file: formatFileRow(result.rows[0]) });
  }));

  app.post('/api/v1/files/:id/unassign', validate({ params: idParamsSchema }), requireAuth, asyncHandler(async (req, res) => {
    const result = await pool.query(
      'UPDATE user_files SET chapter_id = NULL, in_pool = true WHERE id = $1 AND user_id = $2 RETURNING *',
      [req.params.id, req.userId]
    );
    if (result.rows.length === 0) throw new ApiError(404, '文件不存在或不属于你');

    res.json({ file: formatFileRow(result.rows[0]) });
  }));

  // POST /api/v1/files/:id/extend — 文件池续期（消耗积分 10/7天）
  app.post('/api/v1/files/:id/extend', validate({ params: idParamsSchema }), requireAuth, asyncHandler(async (req, res) => {
    const fid = req.params.id;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const fr = await client.query(
        'SELECT * FROM user_files WHERE id = $1 AND user_id = $2 AND in_pool = true',
        [fid, req.userId]
      );
      if (fr.rows.length === 0) throw new ApiError(404, '文件不在文件池中或不属于你');

      const file = fr.rows[0];
      // 扣积分（余额不足 → 400，事务回滚）
      const spend = await pointsService.spendPoints(client, req.userId, P.FILE_EXTEND_COST, {
        reason: 'file_extend',
        note: '文件池续期：' + file.original_name,
      });

      const baseDate = file.pool_expires_at && new Date(file.pool_expires_at) > new Date()
        ? new Date(file.pool_expires_at)
        : new Date();
      const newExpiry = new Date(baseDate.getTime() + P.FILE_EXTEND_DAYS * 24 * 3600 * 1000).toISOString();

      const result = await client.query(
        'UPDATE user_files SET pool_expires_at = $1, points_extended = true WHERE id = $2 AND user_id = $3 RETURNING *',
        [newExpiry, fid, req.userId]
      );
      await client.query('COMMIT');
      res.json({ file: formatFileRow(result.rows[0]), balance: spend.balance, pointsSpent: P.FILE_EXTEND_COST });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }));
};