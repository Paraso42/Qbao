const { pool } = require('../db');
const { hashPassword, comparePassword, signToken, isAdminUsername } = require('../auth');
const { requireAuth } = require('../middleware');

function userToObj(row) {
  return {
    id: row.id, username: row.username,
    displayName: row.display_name, role: row.role,
    avatarUrl: row.avatar_url || null
  };
}

module.exports = function (app) {
  // POST /api/v1/auth/register
  app.post('/api/v1/auth/register', async (req, res) => {
    try {
      const { username, password, displayName } = req.body;
      if (!username || !password) return res.status(422).json({ error: '用户名和密码必填' });
      if (username.length < 3 || username.length > 32) return res.status(422).json({ error: '用户名 3-32 字符' });
      if (password.length < 6) return res.status(422).json({ error: '密码至少 6 位' });

      const role = isAdminUsername(username) ? 'admin' : 'user';
      const hash = await hashPassword(password);
      const name = (displayName || username).trim();
      const result = await pool.query(
        'INSERT INTO users (username, password_hash, display_name, role) VALUES ($1, $2, $3, $4) RETURNING id, username, display_name, role, avatar_url',
        [username, hash, name, role]
      );
      const user = result.rows[0];
      const token = signToken(user.id, user.role);
      res.json({ user: userToObj(user), token });
    } catch (e) {
      if (e.code === '23505') res.status(409).json({ error: '用户名已存在' });
      else res.status(500).json({ error: e.message });
    }
  });

  // POST /api/v1/auth/login
  app.post('/api/v1/auth/login', async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) return res.status(422).json({ error: '用户名和密码必填' });

      const result = await pool.query(
        'SELECT * FROM users WHERE username = $1', [username]);
      if (result.rows.length === 0) return res.status(401).json({ error: '用户名或密码错误' });

      const user = result.rows[0];

      // 封禁检查
      if (user.is_banned) return res.status(403).json({ error: '账号已被封禁' });

      const ok = await comparePassword(password, user.password_hash);
      if (!ok) return res.status(401).json({ error: '用户名或密码错误' });

      // 更新最后登录时间
      await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

      const token = signToken(user.id, user.role);
      res.json({ user: userToObj(user), token });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/v1/auth/me
  app.get('/api/v1/auth/me', requireAuth, async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT id, username, display_name, role, created_at, avatar_url, last_login_at, last_active_at FROM users WHERE id = $1',
        [req.userId]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: '用户不存在' });
      const u = result.rows[0];
      res.json({
        id: u.id, username: u.username, displayName: u.display_name,
        role: u.role, createdAt: u.created_at,
        avatarUrl: u.avatar_url || null,
        lastLoginAt: u.last_login_at, lastActiveAt: u.last_active_at
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
};
