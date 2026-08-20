'use strict';

const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { pool } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware');
const { asyncHandler, ApiError } = require('../lib/errorHandler');
const { validate } = require('../lib/validate');
const {
  issueIdParamsSchema,
  createIssueSchema,
  updateIssueTitleSchema,
  issueMessageSchema,
  issueStatusSchema,
} = require('../schemas/issues.schema');

const { IMAGE_ALLOWED_EXTS } = require('../config/files');
const { isTrustedUpload } = require('../lib/fileSniff');

const issueUploadDir = path.join(__dirname, '..', '..', '..', 'uploads', 'issues');
if (!fs.existsSync(issueUploadDir)) fs.mkdirSync(issueUploadDir, { recursive: true });

// T2 整改：扩展名白名单（不含 .svg）+ 落盘后 magic bytes 校验，拒绝 SVG/伪装图片。
const issueUpload = multer({
  storage: multer.diskStorage({
    destination: issueUploadDir,
    filename: function (req, file, cb) {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.png';
      cb(null, 'issue_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + ext);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!IMAGE_ALLOWED_EXTS.includes(ext)) {
      const error = new Error('仅支持 png/jpg/jpeg/gif/webp 图片');
      error.status = 422;
      return cb(error);
    }
    cb(null, true);
  },
});

async function validateIssueImage(file) {
  if (!file || !file.path || !fs.existsSync(file.path)) return file;
  const ext = path.extname(file.originalname || '').toLowerCase();
  const fd = fs.openSync(file.path, 'r');
  const buf = Buffer.alloc(16);
  fs.readSync(fd, buf, 0, 16, 0);
  fs.closeSync(fd);
  if (!isTrustedUpload(buf, ext)) {
    try { fs.unlinkSync(file.path); } catch (_) {}
    const error = new Error('文件内容与扩展名不符，已拒绝上传');
    error.status = 422;
    throw error;
  }
  return file;
}

function removeIssueImages(rows) {
  for (const row of rows) {
    const images = Array.isArray(row.images) ? row.images : [];
    for (const imageUrl of images) {
      if (typeof imageUrl !== 'string') continue;
      const filename = path.basename(imageUrl);
      const filePath = path.join(issueUploadDir, filename);
      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
    }
  }
}

module.exports = function (app) {
  app.post('/api/v1/issues', validate({ body: createIssueSchema }), requireAuth, asyncHandler(async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const issueResult = await client.query(
        'INSERT INTO issues (user_id, title, status, has_new_for_user, has_new_for_admin) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [req.userId, req.body.title.trim(), 'unread', false, true]
      );
      await client.query(
        'INSERT INTO issue_messages (issue_id, user_id, content, is_system) VALUES ($1, $2, $3, $4)',
        [issueResult.rows[0].id, req.userId, req.body.content.trim(), false]
      );
      await client.query('COMMIT');
      res.status(201).json(issueResult.rows[0]);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }));

  app.get('/api/v1/issues', requireAuth, asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT i.*,
              (SELECT u.display_name FROM users u WHERE u.id = i.user_id) AS user_display_name,
              (SELECT COUNT(*) FROM issue_messages WHERE issue_id = i.id) AS message_count
       FROM issues i
       WHERE i.user_id = $1
       ORDER BY i.updated_at DESC`,
      [req.userId]
    );
    res.json(result.rows);
  }));

  app.get('/api/v1/issues/updates', requireAuth, asyncHandler(async (req, res) => {
    const isAdmin = req.userRole === 'admin';
    const result = { user: {}, admin: {} };

    if (isAdmin) {
      const countResult = await pool.query("SELECT COUNT(*) AS cnt FROM issues WHERE status IN ('unread', 'read')");
      result.admin.unreadCount = parseInt(countResult.rows[0].cnt);

      const newResult = await pool.query(
        "SELECT id, title, user_id FROM issues WHERE status = 'unread' AND has_new_for_admin = true ORDER BY created_at DESC LIMIT 5"
      );
      result.admin.newIssues = newResult.rows;

      const updatedResult = await pool.query(
        "SELECT id FROM issues WHERE updated_at > NOW() - INTERVAL '30 seconds' ORDER BY updated_at DESC"
      );
      result.admin.updatedIssues = updatedResult.rows.map((r) => r.id);
    }

    const userCountResult = await pool.query(
      'SELECT COUNT(*) AS cnt FROM issues WHERE user_id = $1 AND has_new_for_user = true',
      [req.userId]
    );
    result.user.unreadCount = parseInt(userCountResult.rows[0].cnt);

    const userUpdatedResult = await pool.query(
      "SELECT id FROM issues WHERE user_id = $1 AND updated_at > NOW() - INTERVAL '30 seconds' ORDER BY updated_at DESC",
      [req.userId]
    );
    result.user.updatedIssues = userUpdatedResult.rows.map((r) => r.id);

    const newMsgResult = await pool.query(
      'SELECT issue_id, COUNT(*) AS cnt FROM issue_messages WHERE issue_id IN (SELECT id FROM issues WHERE user_id = $1 AND has_new_for_user = true) GROUP BY issue_id',
      [req.userId]
    );
    const newMessages = {};
    newMsgResult.rows.forEach((r) => { newMessages[r.issue_id] = parseInt(r.cnt); });
    result.user.newMessages = newMessages;

    res.json(result);
  }));

  app.delete('/api/v1/issues/:id', validate({ params: issueIdParamsSchema }), requireAdmin, asyncHandler(async (req, res) => {
    const id = req.params.id;
    const client = await pool.connect();
    try {
      const existing = await client.query('SELECT * FROM issues WHERE id = $1', [id]);
      if (existing.rows.length === 0) throw new ApiError(404, 'Issue 不存在');
      if (existing.rows[0].status === 'closed') throw new ApiError(422, '已完成的 Issue 不可删除');

      await client.query('BEGIN');
      const imgs = await client.query('SELECT images FROM issue_messages WHERE issue_id = $1', [id]);
      removeIssueImages(imgs.rows);
      await client.query('DELETE FROM issue_messages WHERE issue_id = $1', [id]);
      await client.query('DELETE FROM issues WHERE id = $1', [id]);
      await client.query('COMMIT');
      res.json({ deleted: true });
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw e;
    } finally {
      client.release();
    }
  }));

  app.get('/api/v1/issues/admin', requireAdmin, asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT i.*,
              u.display_name AS user_display_name,
              u.username AS user_username,
              (SELECT COUNT(*) FROM issue_messages WHERE issue_id = i.id) AS message_count
       FROM issues i
       LEFT JOIN users u ON i.user_id = u.id
       ORDER BY CASE i.status
                  WHEN 'unread' THEN 0
                  WHEN 'read' THEN 1
                  WHEN 'resolved' THEN 2
                  WHEN 'closed' THEN 3
                END,
                i.updated_at DESC`
    );
    res.json(result.rows);
  }));

  app.post('/api/v1/issues/upload', requireAuth, issueUpload.single('image'), asyncHandler(async (req, res) => {
    if (!req.file) throw new ApiError(422, '请选择图片文件');
    // T2：magic bytes 二次校验（fileFilter 只拦扩展名，此处验真实内容）
    await validateIssueImage(req.file);
    res.json({ url: '/api/v1/issues/images/' + req.file.filename, name: req.file.originalname, size: req.file.size });
  }));

  app.get('/api/v1/issues/images/:filename', asyncHandler(async (req, res) => {
    const requested = req.params.filename;
    const filename = path.basename(requested);
    if (filename !== requested || filename.includes('..')) throw new ApiError(404, '图片不存在或已删除');

    const filePath = path.join(issueUploadDir, filename);
    if (!fs.existsSync(filePath)) throw new ApiError(404, '图片不存在或已删除');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    res.sendFile(filePath);
  }));

  app.put('/api/v1/issues/:id', validate({ params: issueIdParamsSchema, body: updateIssueTitleSchema }), requireAuth, asyncHandler(async (req, res) => {
    const id = req.params.id;
    const existing = await pool.query('SELECT * FROM issues WHERE id = $1', [id]);
    if (existing.rows.length === 0) throw new ApiError(404, 'Issue 不存在');

    const issue = existing.rows[0];
    if (issue.user_id !== req.userId) throw new ApiError(403, '只能编辑自己的 Issue');
    if (issue.status === 'closed') throw new ApiError(422, '已关闭的 Issue 不可编辑');

    const result = await pool.query(
      'UPDATE issues SET title = $1, updated_at = now() WHERE id = $2 RETURNING *',
      [req.body.title.trim(), id]
    );
    res.json(result.rows[0]);
  }));

  app.get('/api/v1/issues/:id', validate({ params: issueIdParamsSchema }), requireAuth, asyncHandler(async (req, res) => {
    const id = req.params.id;
    const issueResult = await pool.query('SELECT * FROM issues WHERE id = $1', [id]);
    if (issueResult.rows.length === 0) throw new ApiError(404, 'Issue 不存在');

    const issue = issueResult.rows[0];
    if (issue.user_id !== req.userId && req.userRole !== 'admin') {
      throw new ApiError(403, '无权查看此 Issue');
    }

    const userResult = await pool.query('SELECT display_name FROM users WHERE id = $1', [issue.user_id]);
    issue.user_display_name = userResult.rows[0] ? userResult.rows[0].display_name : 'Unknown';

    const msgResult = await pool.query(
      `SELECT im.*, u.display_name AS sender_name
       FROM issue_messages im
       LEFT JOIN users u ON im.user_id = u.id
       WHERE im.issue_id = $1
       ORDER BY im.created_at ASC`,
      [id]
    );
    issue.messages = msgResult.rows;

    if (req.userRole === 'admin') {
      await pool.query('UPDATE issues SET has_new_for_admin = false WHERE id = $1', [id]);
    } else {
      await pool.query('UPDATE issues SET has_new_for_user = false WHERE id = $1', [id]);
    }

    res.json(issue);
  }));

  app.post('/api/v1/issues/:id/messages', validate({ params: issueIdParamsSchema, body: issueMessageSchema }), requireAuth, asyncHandler(async (req, res) => {
    const id = req.params.id;
    const content = (req.body.content || '').trim();
    const images = Array.isArray(req.body.images) ? req.body.images : [];
    if (!content && images.length === 0) throw new ApiError(422, '内容不能为空');

    const issueResult = await pool.query('SELECT * FROM issues WHERE id = $1', [id]);
    if (issueResult.rows.length === 0) throw new ApiError(404, 'Issue 不存在');

    const issue = issueResult.rows[0];
    if (issue.user_id !== req.userId && req.userRole !== 'admin') throw new ApiError(403, '无权在此 Issue 发送消息');
    if (issue.status === 'closed') throw new ApiError(422, '已关闭的 Issue 不可再发消息');

    const msgResult = await pool.query(
      'INSERT INTO issue_messages (issue_id, user_id, content, images, is_system) VALUES ($1, $2, $3, $4, false) RETURNING *',
      [id, req.userId, content, JSON.stringify(images)]
    );

    if (req.userRole === 'admin') {
      await pool.query('UPDATE issues SET has_new_for_user = true, updated_at = now() WHERE id = $1', [id]);
    } else {
      await pool.query('UPDATE issues SET has_new_for_admin = true, updated_at = now() WHERE id = $1', [id]);
    }

    res.status(201).json(msgResult.rows[0]);
  }));

  app.patch('/api/v1/issues/:id/status', validate({ params: issueIdParamsSchema, body: issueStatusSchema }), requireAuth, asyncHandler(async (req, res) => {
    const id = req.params.id;
    const status = req.body.status;
    const reason = (req.body.reason || '').trim();

    const client = await pool.connect();
    try {
      const issueResult = await client.query('SELECT * FROM issues WHERE id = $1', [id]);
      if (issueResult.rows.length === 0) throw new ApiError(404, 'Issue 不存在');

      const issue = issueResult.rows[0];
      const isAdmin = req.userRole === 'admin';
      const isOwner = issue.user_id === req.userId;
      if (!isAdmin && !isOwner) throw new ApiError(403, '无权操作此 Issue');

      let systemMsg = '';
      if (isAdmin) {
        if (status === 'read' && issue.status !== 'unread') throw new ApiError(422, '只能将未读的 Issue 标记为已读');
        if (status === 'resolved' && issue.status !== 'read') throw new ApiError(422, '只能将已读的 Issue 标记为处理完毕');
        if (status === 'read') systemMsg = '管理员已将状态改为"已读"';
        if (status === 'resolved') systemMsg = '管理员已将状态改为"处理完毕"，请验证修复结果';
      } else {
        if (status === 'closed' && issue.status !== 'resolved') throw new ApiError(422, '只能对处理完毕的 Issue 进行验证');
        if (status === 'unread' && issue.status !== 'resolved') throw new ApiError(422, '只能对处理完毕的 Issue 反馈未修复');
        if (status === 'closed') systemMsg = '用户已确认修复，Issue 关闭';
        if (status === 'unread') {
          if (!reason) throw new ApiError(422, '请说明未修复的具体情况');
          systemMsg = '用户反馈未修复，原因：' + reason;
        }
      }

      if (issue.status === 'closed') throw new ApiError(422, '已关闭的 Issue 不可再修改状态');

      await client.query('BEGIN');
      await client.query('UPDATE issues SET status = $1, updated_at = now() WHERE id = $2', [status, id]);
      await client.query(
        'INSERT INTO issue_messages (issue_id, user_id, content, is_system) VALUES ($1, $2, $3, true)',
        [id, req.userId, systemMsg]
      );
      if (isAdmin) {
        await client.query('UPDATE issues SET has_new_for_user = true WHERE id = $1', [id]);
      } else {
        await client.query('UPDATE issues SET has_new_for_admin = true WHERE id = $1', [id]);
      }
      await client.query('COMMIT');

      if (status === 'closed') {
        try {
          const imgs = await pool.query('SELECT images FROM issue_messages WHERE issue_id = $1', [id]);
          removeIssueImages(imgs.rows);
          await pool.query("UPDATE issue_messages SET images = '[]'::jsonb WHERE issue_id = $1", [id]);
        } catch (e) {
          console.warn('Issue image cleanup error:', e.message);
        }
      }

      const updated = await pool.query('SELECT * FROM issues WHERE id = $1', [id]);
      res.json(updated.rows[0]);
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw e;
    } finally {
      client.release();
    }
  }));
};
