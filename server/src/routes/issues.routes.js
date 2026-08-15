const { pool } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// 确保 uploads/issues 目录存在
const issueUploadDir = path.join(__dirname, '..', '..', '..', 'uploads', 'issues');
if (!fs.existsSync(issueUploadDir)) fs.mkdirSync(issueUploadDir, { recursive: true });

const issueUpload = multer({
  storage: multer.diskStorage({
    destination: issueUploadDir,
    filename: function (req, file, cb) {
      var ext = path.extname(file.originalname) || '.png';
      cb(null, 'issue_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + ext);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: function (req, file, cb) {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('仅支持图片文件'));
    cb(null, true);
  }
});

module.exports = function (app) {

  // ===== 固定路径端点（必须在 /:id 之前注册）=====

  // POST /api/v1/issues — 提交新 issue
  app.post('/api/v1/issues', requireAuth, async (req, res) => {
    const client = await pool.connect();
    try {
      const { title, content } = req.body;
      if (!title || !title.trim()) return res.status(422).json({ error: '标题不能为空' });
      if (!content || !content.trim()) return res.status(422).json({ error: '内容不能为空' });
      if (title.length > 500) return res.status(422).json({ error: '标题不能超过500字' });

      await client.query('BEGIN');

      const issueResult = await client.query(
        'INSERT INTO issues (user_id, title, status, has_new_for_user, has_new_for_admin) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [req.userId, title.trim(), 'unread', false, true]
      );
      const issue = issueResult.rows[0];

      await client.query(
        'INSERT INTO issue_messages (issue_id, user_id, content, is_system) VALUES ($1, $2, $3, $4)',
        [issue.id, req.userId, content.trim(), false]
      );

      await client.query('COMMIT');
      res.status(201).json(issue);
    } catch (e) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: e.message });
    } finally {
      client.release();
    }
  });

  // GET /api/v1/issues — 获取当前用户的 issue 列表
  app.get('/api/v1/issues', requireAuth, async (req, res) => {
    try {
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
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/v1/issues/updates — 轮询端点
  app.get('/api/v1/issues/updates', requireAuth, async (req, res) => {
    try {
      const isAdmin = req.userRole === 'admin';
      var result = { user: {}, admin: {} };

      if (isAdmin) {
        const countResult = await pool.query(
          "SELECT COUNT(*) AS cnt FROM issues WHERE status IN ('unread', 'read')"
        );
        result.admin.unreadCount = parseInt(countResult.rows[0].cnt);

        const newResult = await pool.query(
          "SELECT id, title, user_id FROM issues WHERE status = 'unread' AND has_new_for_admin = true ORDER BY created_at DESC LIMIT 5"
        );
        result.admin.newIssues = newResult.rows;

        const updatedResult = await pool.query(
          "SELECT id FROM issues WHERE updated_at > NOW() - INTERVAL '30 seconds' ORDER BY updated_at DESC"
        );
        result.admin.updatedIssues = updatedResult.rows.map(r => r.id);
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
      result.user.updatedIssues = userUpdatedResult.rows.map(r => r.id);

      const newMsgResult = await pool.query(
        'SELECT issue_id, COUNT(*) AS cnt FROM issue_messages WHERE issue_id IN (SELECT id FROM issues WHERE user_id = $1 AND has_new_for_user = true) GROUP BY issue_id',
        [req.userId]
      );
      var newMessages = {};
      newMsgResult.rows.forEach(r => { newMessages[r.issue_id] = parseInt(r.cnt); });
      result.user.newMessages = newMessages;

      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // DELETE /api/v1/issues/:id — 管理员删除 issue（不能删除 closed）
  app.delete('/api/v1/issues/:id', requireAdmin, async (req, res) => {
    const client = await pool.connect();
    try {
      const { id } = req.params;
      const existing = await client.query('SELECT * FROM issues WHERE id = $1', [id]);
      if (existing.rows.length === 0) return res.status(404).json({ error: 'Issue 不存在' });
      if (existing.rows[0].status === 'closed') return res.status(422).json({ error: '已完成的 Issue 不可删除' });

      // 清理图片
      var imgs = await client.query('SELECT images FROM issue_messages WHERE issue_id = $1', [id]);
      imgs.rows.forEach(function(r) {
        (r.images || []).forEach(function(imgUrl) {
          var filename = imgUrl.split('/').pop();
          var fp = path.join(issueUploadDir, filename);
          if (fs.existsSync(fp)) fs.unlinkSync(fp);
        });
      });

      await client.query('DELETE FROM issue_messages WHERE issue_id = $1', [id]);
      await client.query('DELETE FROM issues WHERE id = $1', [id]);
      res.json({ deleted: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    } finally {
      client.release();
    }
  });

  // GET /api/v1/issues/admin — 管理员获取全部 issue（必须在 /:id 之前）
  app.get('/api/v1/issues/admin', requireAdmin, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT i.*,
           u.display_name AS user_display_name,
           u.username AS user_username,
           (SELECT COUNT(*) FROM issue_messages WHERE issue_id = i.id) AS message_count
         FROM issues i
         LEFT JOIN users u ON i.user_id = u.id
         ORDER BY
           CASE i.status
             WHEN 'unread' THEN 0
             WHEN 'read' THEN 1
             WHEN 'resolved' THEN 2
             WHEN 'closed' THEN 3
           END,
           i.updated_at DESC`
      );
      res.json(result.rows);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/v1/issues/upload — 上传图片（用于 issue 消息）
  app.post('/api/v1/issues/upload', requireAuth, issueUpload.single('image'), async (req, res) => {
    try {
      if (!req.file) return res.status(422).json({ error: '请选择图片文件' });
      var url = '/api/v1/issues/images/' + req.file.filename;
      res.json({ url: url, name: req.file.originalname, size: req.file.size });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/v1/issues/images/:filename — 提供图片（绕过 Nginx 静态文件问题）
  app.get('/api/v1/issues/images/:filename', function (req, res) {
    var fp = path.join(issueUploadDir, req.params.filename);
    if (!fs.existsSync(fp)) return res.status(404).json({ error: '图片不存在或已删除' });
    res.sendFile(fp);
  });

  // ===== /:id 参数化端点（必须在固定路径之后注册）=====

  // PUT /api/v1/issues/:id — 编辑 issue 标题
  app.put('/api/v1/issues/:id', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { title } = req.body;
      if (!title || !title.trim()) return res.status(422).json({ error: '标题不能为空' });

      const existing = await pool.query('SELECT * FROM issues WHERE id = $1', [id]);
      if (existing.rows.length === 0) return res.status(404).json({ error: 'Issue 不存在' });

      const issue = existing.rows[0];
      if (issue.user_id !== req.userId) return res.status(403).json({ error: '只能编辑自己的 Issue' });
      if (issue.status === 'closed') return res.status(422).json({ error: '已关闭的 Issue 不可编辑' });

      const result = await pool.query(
        'UPDATE issues SET title = $1, updated_at = now() WHERE id = $2 RETURNING *',
        [title.trim(), id]
      );
      res.json(result.rows[0]);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/v1/issues/:id — 获取单个 issue 详情
  app.get('/api/v1/issues/:id', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      // 防止 'admin' 'updates' 等固定路径误入（二次保险）
      if (id === 'admin' || id === 'updates') return res.status(404).json({ error: 'Issue 不存在' });

      const issueResult = await pool.query('SELECT * FROM issues WHERE id = $1', [id]);
      if (issueResult.rows.length === 0) return res.status(404).json({ error: 'Issue 不存在' });

      const issue = issueResult.rows[0];
      if (issue.user_id !== req.userId && req.userRole !== 'admin') {
        return res.status(403).json({ error: '无权查看此 Issue' });
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
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/v1/issues/:id/messages — 发送消息
  app.post('/api/v1/issues/:id/messages', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const { content } = req.body;
      const images = Array.isArray(req.body.images) ? req.body.images : [];
      if ((!content || !content.trim()) && images.length === 0) return res.status(422).json({ error: '内容不能为空' });

      const issueResult = await pool.query('SELECT * FROM issues WHERE id = $1', [id]);
      if (issueResult.rows.length === 0) return res.status(404).json({ error: 'Issue 不存在' });

      const issue = issueResult.rows[0];
      if (issue.user_id !== req.userId && req.userRole !== 'admin') {
        return res.status(403).json({ error: '无权在此 Issue 发送消息' });
      }
      if (issue.status === 'closed') return res.status(422).json({ error: '已关闭的 Issue 不可再发消息' });

      const msgResult = await pool.query(
        'INSERT INTO issue_messages (issue_id, user_id, content, images, is_system) VALUES ($1, $2, $3, $4, false) RETURNING *',
        [id, req.userId, content.trim(), JSON.stringify(images)]
      );

      if (req.userRole === 'admin') {
        await pool.query('UPDATE issues SET has_new_for_user = true, updated_at = now() WHERE id = $1', [id]);
      } else {
        await pool.query('UPDATE issues SET has_new_for_admin = true, updated_at = now() WHERE id = $1', [id]);
      }

      res.status(201).json(msgResult.rows[0]);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // PATCH /api/v1/issues/:id/status — 更新状态
  app.patch('/api/v1/issues/:id/status', requireAuth, async (req, res) => {
    const client = await pool.connect();
    try {
      const { id } = req.params;
      const { status, reason } = req.body;
      const validStatuses = ['unread', 'read', 'resolved', 'closed'];

      if (!status || validStatuses.indexOf(status) === -1) {
        return res.status(422).json({ error: '无效的状态值' });
      }

      const issueResult = await client.query('SELECT * FROM issues WHERE id = $1', [id]);
      if (issueResult.rows.length === 0) return res.status(404).json({ error: 'Issue 不存在' });

      const issue = issueResult.rows[0];
      const isAdmin = req.userRole === 'admin';
      const isOwner = issue.user_id === req.userId;

      if (!isAdmin && !isOwner) return res.status(403).json({ error: '无权操作此 Issue' });

      var systemMsg = '';
      var targetStatus = status;

      if (isAdmin) {
        if (targetStatus === 'read' && issue.status !== 'unread') {
          return res.status(422).json({ error: '只能将未读的 Issue 标记为已读' });
        }
        if (targetStatus === 'resolved' && issue.status !== 'read') {
          return res.status(422).json({ error: '只能将已读的 Issue 标记为处理完毕' });
        }
        if (targetStatus === 'read') systemMsg = '管理员已将状态改为"已读"';
        if (targetStatus === 'resolved') systemMsg = '管理员已将状态改为"处理完毕"，请验证修复结果';
      } else {
        if (targetStatus === 'closed' && issue.status !== 'resolved') {
          return res.status(422).json({ error: '只能对处理完毕的 Issue 进行验证' });
        }
        if (targetStatus === 'unread' && issue.status !== 'resolved') {
          return res.status(422).json({ error: '只能对处理完毕的 Issue 反馈未修复' });
        }
        if (targetStatus === 'closed') {
          systemMsg = '用户已确认修复，Issue 关闭';
        }
        if (targetStatus === 'unread') {
          if (!reason || !reason.trim()) return res.status(422).json({ error: '请说明未修复的具体情况' });
          systemMsg = '用户反馈未修复，原因：' + reason.trim();
        }
      }

      if (issue.status === 'closed') {
        return res.status(422).json({ error: '已关闭的 Issue 不可再修改状态' });
      }

      await client.query('BEGIN');

      await client.query(
        'UPDATE issues SET status = $1, updated_at = now() WHERE id = $2',
        [targetStatus, id]
      );

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

      // issue 关闭后清理图片文件
      if (targetStatus === 'closed') {
        try {
          var imgs = await pool.query('SELECT images FROM issue_messages WHERE issue_id = $1', [id]);
          imgs.rows.forEach(function(r) {
            (r.images || []).forEach(function(imgUrl) {
              // URL 格式: /api/v1/issues/images/filename
              var filename = imgUrl.split('/').pop();
              var fp = path.join(issueUploadDir, filename);
              if (fs.existsSync(fp)) fs.unlinkSync(fp);
            });
          });
          // 清空该 issue 所有消息的 images 字段（标记为已删除）
          await pool.query("UPDATE issue_messages SET images = '[]'::jsonb WHERE issue_id = $1", [id]);
        } catch(e) { console.warn('Issue image cleanup error:', e.message); }
      }

      const updated = await pool.query('SELECT * FROM issues WHERE id = $1', [id]);
      res.json(updated.rows[0]);
    } catch (e) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: e.message });
    } finally {
      client.release();
    }
  });

};
