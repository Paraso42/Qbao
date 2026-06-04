const { pool } = require('../db');
const { requireAuth } = require('../middleware');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOAD_BASE = path.join(__dirname, '../../../uploads/pool');
if (!fs.existsSync(UPLOAD_BASE)) fs.mkdirSync(UPLOAD_BASE, { recursive: true });

// Multer storage: each user gets a subdirectory
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const userDir = path.join(UPLOAD_BASE, String(req.userId));
    if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
    cb(null, userDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const stored = crypto.randomBytes(12).toString('hex') + ext;
    cb(null, stored);
  }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } }); // 20MB

// Cleanup expired files for a user — removes DB records + disk files
async function cleanupExpiredFiles(userId) {
  try {
    const result = await pool.query(
      `DELETE FROM user_files WHERE user_id = $1 AND in_pool = true
       AND pool_expires_at IS NOT NULL AND pool_expires_at < NOW() RETURNING file_path`,
      [userId]
    );
    for (const row of result.rows) {
      const absPath = path.join(UPLOAD_BASE, '..', row.file_path);
      try { if (fs.existsSync(absPath)) fs.unlinkSync(absPath); } catch (e) { /* ignore */ }
    }
    return result.rows.length;
  } catch (e) {
    console.error('cleanupExpiredFiles error:', e.message);
    return 0;
  }
}

// Format file row for API response
function formatFileRow(row) {
  return {
    id: row.id, originalName: row.original_name, storedName: row.stored_name,
    fileSize: parseInt(row.file_size), mimeType: row.mime_type,
    chapterId: row.chapter_id, inPool: row.in_pool,
    poolExpiresAt: row.pool_expires_at,
    pointsExtended: row.points_extended, createdAt: row.created_at
  };
}

module.exports = function (app) {
  // POST /api/v1/files/upload — upload file to pool
  app.post('/api/v1/files/upload', requireAuth, upload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(422).json({ error: '未上传文件' });

      const userId = req.userId;
      const originalName = Buffer.from(req.file.originalname, "latin1").toString("utf8");
      const storedName = req.file.filename;
      const fileSize = req.file.size;
      const mimeType = req.file.mimetype || '';
      const chapterId = req.body.chapterId || null;
      // Relative path from uploads/ for portability
      const relPath = 'pool/' + userId + '/' + storedName;

      // Default pool expiry: 7 days
      const poolExpiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

      const result = await pool.query(
        `INSERT INTO user_files (user_id, original_name, stored_name, file_size, file_path, mime_type, chapter_id, pool_expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [userId, originalName, storedName, fileSize, relPath, mimeType, chapterId, poolExpiresAt]
      );

      res.status(201).json({ file: formatFileRow(result.rows[0]) });
    } catch (e) {
      console.error('file upload error:', e.message);
      // Clean up disk file on DB error
      if (req.file && req.file.path && fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch (_) {}
      }
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/v1/files — list user files
  app.get('/api/v1/files', requireAuth, async (req, res) => {
    try {
      // Cleanup expired first to keep listing accurate
      await cleanupExpiredFiles(req.userId);

      var sql = 'SELECT * FROM user_files WHERE user_id = $1';
      var params = [req.userId];
      var pi = 1;

      if (req.query.pool === 'true') {
        pi++; sql += ' AND in_pool = $' + pi; params.push(true);
      }
      if (req.query.chapter_id) {
        pi++; sql += ' AND chapter_id = $' + pi; params.push(req.query.chapter_id);
      }
      sql += ' ORDER BY created_at DESC';

      const result = await pool.query(sql, params);
      res.json({ files: result.rows.map(formatFileRow) });
    } catch (e) {
      console.error('files list error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // DELETE /api/v1/files/:id — delete file (disk + DB)
  app.delete('/api/v1/files/:id', requireAuth, async (req, res) => {
    try {
      const result = await pool.query(
        'DELETE FROM user_files WHERE id = $1 AND user_id = $2 RETURNING file_path',
        [parseInt(req.params.id), req.userId]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: '文件不存在' });

      const absPath = path.join(UPLOAD_BASE, '..', result.rows[0].file_path);
      try { if (fs.existsSync(absPath)) fs.unlinkSync(absPath); } catch (e) { /* ignore */ }

      res.json({ ok: true });
    } catch (e) {
      console.error('file delete error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/v1/files/:id/assign — assign pool file to a chapter
  app.post('/api/v1/files/:id/assign', requireAuth, async (req, res) => {
    try {
      const { chapterId } = req.body;
      if (!chapterId) return res.status(422).json({ error: '缺少 chapterId' });

      const result = await pool.query(
        'UPDATE user_files SET chapter_id = $1 WHERE id = $2 AND user_id = $3 RETURNING *',
        [chapterId, parseInt(req.params.id), req.userId]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: '文件不存在或不属于你' });

      res.json({ file: formatFileRow(result.rows[0]) });
    } catch (e) {
      console.error('file assign error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/v1/files/:id/extend — extend pool storage (points placeholder)
  app.post('/api/v1/files/:id/extend', requireAuth, async (req, res) => {
    try {
      const fid = parseInt(req.params.id);
      const fr = await pool.query(
        'SELECT * FROM user_files WHERE id = $1 AND user_id = $2 AND in_pool = true',
        [fid, req.userId]
      );
      if (fr.rows.length === 0) return res.status(404).json({ error: '文件不在文件池中或不属于你' });

      const file = fr.rows[0];
      // Extend by 7 days from now (or from current expiry if already expired)
      const baseDate = file.pool_expires_at && new Date(file.pool_expires_at) > new Date()
        ? new Date(file.pool_expires_at) : new Date();
      const newExpiry = new Date(baseDate.getTime() + 7 * 24 * 3600 * 1000).toISOString();

      const result = await pool.query(
        'UPDATE user_files SET pool_expires_at = $1, points_extended = true WHERE id = $2 AND user_id = $3 RETURNING *',
        [newExpiry, fid, req.userId]
      );

      res.json({ file: formatFileRow(result.rows[0]) });
    } catch (e) {
      console.error('file extend error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });
};
