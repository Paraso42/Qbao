const { pool } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware');

module.exports = function (app) {
  // GET /api/v1/notices — 公开端点，仅返回已启用、未过期的消息
  app.get('/api/v1/notices', async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT id, content, type, link, sort_order, duration FROM notices WHERE enabled = true AND (expire_at IS NULL OR expire_at > now()) ORDER BY sort_order ASC, id ASC',
      );
      res.json(result.rows);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/v1/notices/all — 管理员：全部消息
  app.get('/api/v1/notices/all', requireAdmin, async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT n.id, n.content, n.type, n.link, n.enabled, n.sort_order, n.expire_at, n.created_at, n.updated_at, n.duration, u.username as created_by_name FROM notices n LEFT JOIN users u ON n.created_by = u.id ORDER BY n.sort_order ASC, n.id ASC',
      );
      res.json(result.rows);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/v1/notices — 新增消息
  app.post('/api/v1/notices', requireAdmin, async (req, res) => {
    try {
      const { content, type, link, expire_at, duration } = req.body;
      if (!content || !content.trim()) return res.status(422).json({ error: '内容不能为空' });
      if (content.length > 500) return res.status(422).json({ error: '内容不能超过500字' });

      const dur = duration ? parseInt(duration) : 4000;
      const result = await pool.query(
        'INSERT INTO notices (content, type, link, expire_at, created_by, duration) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, content, type, link, enabled, sort_order, expire_at, created_at, duration',
        [content.trim(), type || 'notice', link || null, expire_at ? new Date(expire_at) : null, req.userId, dur]
      );
      res.status(201).json(result.rows[0]);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // PUT /api/v1/notices/:id — 编辑消息
  app.put('/api/v1/notices/:id', requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { content, type, link, expire_at, duration } = req.body;

      const existing = await pool.query('SELECT * FROM notices WHERE id = $1', [id]);
      if (existing.rows.length === 0) return res.status(404).json({ error: '消息不存在' });

      const old = existing.rows[0];
      const updContent = content !== undefined ? content.trim() : old.content;
      if (!updContent) return res.status(422).json({ error: '内容不能为空' });
      const updDuration = duration !== undefined ? parseInt(duration) : (old.duration || 4000);

      const result = await pool.query(
        'UPDATE notices SET content=$1, type=$2, link=$3, expire_at=$4, duration=$5, updated_at=now() WHERE id=$6 RETURNING id, content, type, link, enabled, sort_order, expire_at, updated_at, duration',
        [updContent, type || old.type, link !== undefined ? link : old.link, expire_at !== undefined ? (expire_at ? new Date(expire_at) : null) : old.expire_at, updDuration, id]
      );
      res.json(result.rows[0]);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // DELETE /api/v1/notices/:id — 删除消息
  app.delete('/api/v1/notices/:id', requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const result = await pool.query('DELETE FROM notices WHERE id = $1 RETURNING id', [id]);
      if (result.rows.length === 0) return res.status(404).json({ error: '消息不存在' });
      res.json({ deleted: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // PATCH /api/v1/notices/:id/toggle — 切换启用/停用
  app.patch('/api/v1/notices/:id/toggle', requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const result = await pool.query(
        'UPDATE notices SET enabled = NOT enabled, updated_at = now() WHERE id = $1 RETURNING id, enabled',
        [id]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: '消息不存在' });
      res.json(result.rows[0]);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // PUT /api/v1/notices/sort — 批量更新排序
  app.put('/api/v1/notices/sort', requireAdmin, async (req, res) => {
    try {
      const { items } = req.body; // [{ id, sort_order }]
      if (!Array.isArray(items)) return res.status(422).json({ error: '参数格式错误' });

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const item of items) {
          await client.query('UPDATE notices SET sort_order = $1, updated_at = now() WHERE id = $2', [item.sort_order, item.id]);
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
};
