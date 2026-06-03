const { pool } = require('../db');
const { hashPassword, signToken } = require('../auth');
const { requireAuth, requireAdmin, addToBlacklist, invalidateBannedCache } = require('../middleware');

// 将用户行转为返回对象
function userRow(row) {
  return {
    id: row.id, username: row.username,
    displayName: row.display_name, role: row.role,
    avatarUrl: row.avatar_url || null,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    lastActiveAt: row.last_active_at,
    isOnline: !!(row.is_online),
    isBanned: row.is_banned
  };
}

// 解析用户 state_json 获取统计数据
function parseStats(stateJson) {
  if (!stateJson) return { subjects: 0, chapters: 0, totalQuestions: 0 };
  try {
    var subjects = stateJson.subjects || {};
    var chapters = stateJson.chapters || {};
    var subjCount = Object.keys(subjects).length;
    var chCount = Object.keys(chapters).length;
    var totalQ = 0;
    Object.values(chapters).forEach(function (ch) {
      if (ch.questions && Array.isArray(ch.questions)) {
        totalQ += ch.questions.length;
      }
    });
    return { subjects: subjCount, chapters: chCount, totalQuestions: totalQ };
  } catch (e) {
    return { subjects: 0, chapters: 0, totalQuestions: 0 };
  }
}

module.exports = function (app) {
  // GET /api/v1/users/me — 当前用户
  app.get('/api/v1/users/me', requireAuth, async (req, res) => {
    try {
      const r = await pool.query('SELECT id, username, display_name, role, created_at, avatar_url, last_login_at, last_active_at, is_banned FROM users WHERE id = $1', [req.userId]);
      if (r.rows.length === 0) return res.status(404).json({ error: '用户不存在' });
      const u = r.rows[0];
      res.json({ id: u.id, username: u.username, displayName: u.display_name, role: u.role, createdAt: u.created_at, avatarUrl: u.avatar_url || null, lastLoginAt: u.last_login_at, lastActiveAt: u.last_active_at, isBanned: u.is_banned });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // PUT /api/v1/users/me — 更新当前用户
  app.put('/api/v1/users/me', requireAuth, async (req, res) => {
    try {
      const { displayName, password, newPassword } = req.body;
      var updates = []; var params = []; var i = 0;
      if (displayName !== undefined) { i++; updates.push('display_name = $' + i); params.push(displayName.trim()); }
      if (newPassword) {
        if (!password) return res.status(422).json({ error: '请提供当前密码' });
        const rp = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.userId]);
        if (rp.rows.length === 0) return res.status(404).json({ error: '用户不存在' });
        const ok = await require('../auth').comparePassword(password, rp.rows[0].password_hash);
        if (!ok) return res.status(401).json({ error: '当前密码错误' });
        if (newPassword.length < 6) return res.status(422).json({ error: '新密码至少6位' });
        i++; updates.push('password_hash = $' + i); params.push(await hashPassword(newPassword));
      }
      if (updates.length === 0) return res.status(422).json({ error: '没有需要更新的字段' });
      params.push(req.userId);
      const result = await pool.query('UPDATE users SET ' + updates.join(', ') + ' WHERE id = $' + params.length + ' RETURNING id, username, display_name, role, avatar_url', params);
      if (result.rows.length === 0) return res.status(404).json({ error: '用户不存在' });
      const u = result.rows[0]; const token = signToken(u.id, u.role);
      res.json({ user: { id: u.id, username: u.username, displayName: u.display_name, role: u.role, avatarUrl: u.avatar_url || null }, token });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // PUT /api/v1/users/me/avatar — 设置头像
  app.put('/api/v1/users/me/avatar', requireAuth, async (req, res) => {
    try {
      const { avatar } = req.body;
      if (!avatar) return res.status(422).json({ error: '缺少 avatar 字段' });
      const result = await pool.query('UPDATE users SET avatar_url = $1 WHERE id = $2 RETURNING id, avatar_url', [avatar, req.userId]);
      res.json({ user: { id: result.rows[0].id, avatarUrl: result.rows[0].avatar_url || null } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // PATCH /api/v1/users/me/active — 心跳
  app.patch('/api/v1/users/me/active', requireAuth, async (req, res) => {
    try { await pool.query('UPDATE users SET last_active_at = NOW() WHERE id = $1', [req.userId]); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ===== 以下为管理员接口 =====

  // GET /api/v1/users — 用户列表（分页+搜索）
  app.get('/api/v1/users', requireAdmin, async (req, res) => {
    try {
      var page = Math.max(1, parseInt(req.query.page) || 1);
      var limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
      var offset = (page - 1) * limit;
      var where = []; var params = []; var pi = 0;
      if (req.query.role) { pi++; where.push('role = $' + pi); params.push(req.query.role); }
      if (req.query.banned !== undefined) { pi++; where.push('is_banned = $' + pi); params.push(req.query.banned === 'true'); }
      if (req.query.search) { pi++; where.push('(username ILIKE $' + pi + ' OR display_name ILIKE $' + pi + ')'); params.push('%' + req.query.search + '%'); }
      const wStr = where.length ? ' WHERE ' + where.join(' AND ') : '';
      const countR = await pool.query('SELECT COUNT(*) FROM users' + wStr, params);
      const total = parseInt(countR.rows[0].count);
      const dataR = await pool.query(
        'SELECT id, username, display_name, role, created_at, avatar_url, last_login_at, last_active_at, is_banned, (last_active_at > NOW() - INTERVAL \'5 minutes\') AS is_online FROM users' + wStr + ' ORDER BY created_at DESC LIMIT $' + (pi + 1) + ' OFFSET $' + (pi + 2),
        params.concat([limit, offset]));
      res.json({ total, page, limit, users: dataR.rows.map(userRow) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/v1/users/stats — 管理统计
  app.get('/api/v1/users/stats', requireAdmin, async (req, res) => {
    try {
      const r = await pool.query('SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN role=\'admin\' THEN 1 ELSE 0 END),0) AS adminCount, COALESCE(SUM(CASE WHEN role=\'user\' THEN 1 ELSE 0 END),0) AS userCount, COALESCE(SUM(CASE WHEN is_banned THEN 1 ELSE 0 END),0) AS bannedCount, COALESCE(SUM(CASE WHEN last_active_at > NOW()-INTERVAL \'5 minutes\' THEN 1 ELSE 0 END),0) AS onlineNow, COALESCE(SUM(CASE WHEN last_login_at::date=CURRENT_DATE THEN 1 ELSE 0 END),0) AS todayLogins FROM users');
      const row = r.rows[0];
      res.json({ totalUsers: Number(row.total || 0), adminCount: Number(row.admincount || 0), userCount: Number(row.usercount || 0), bannedCount: Number(row.bannedcount || 0), onlineNow: Number(row.onlinenow || 0), todayLogins: Number(row.todaylogins || 0) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/v1/users/:id — 用户详情（丰富统计）
  app.get('/api/v1/users/:id', requireAdmin, async (req, res) => {
    try {
      const uid = parseInt(req.params.id);
      const ur = await pool.query('SELECT id, username, display_name, role, created_at, avatar_url, last_login_at, last_active_at, is_banned, (last_active_at > NOW()-INTERVAL \'5 minutes\') AS is_online FROM users WHERE id = $1', [uid]);
      if (ur.rows.length === 0) return res.status(404).json({ error: '用户不存在' });
      const u = ur.rows[0];
      // 各表统计
      const sr = await pool.query('SELECT COUNT(*) AS c FROM backups WHERE user_id = $1', [uid]);
      const shar = await pool.query('SELECT COUNT(*) AS c FROM shared_banks WHERE owner_id = $1', [uid]);
      const air = await pool.query('SELECT COUNT(*) AS c FROM ai_request_log WHERE user_id = $1', [uid]);
      // 解析 user_data 获取题目数等
      const dr = await pool.query('SELECT state_json FROM user_data WHERE user_id = $1', [uid]);
      const stateStats = parseStats(dr.rows.length > 0 ? dr.rows[0].state_json : null);
      res.json({ ...userRow(u), stats: { ...stateStats, totalBackups: parseInt(sr.rows[0].c), totalShares: parseInt(shar.rows[0].c), totalAiRequests: parseInt(air.rows[0].c) } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // PUT /api/v1/users/:id — 管理员修改用户
  app.put('/api/v1/users/:id', requireAdmin, async (req, res) => {
    try {
      const uid = parseInt(req.params.id);
      const { displayName, role, password } = req.body;
      var updates = []; var params = []; var i = 0;
      if (displayName !== undefined) { i++; updates.push('display_name = $' + i); params.push(displayName.trim()); }
      if (role) { i++; updates.push('role = $' + i); params.push(role); }
      if (password) {
        if (password.length < 6) return res.status(422).json({ error: '密码至少6位' });
        i++; updates.push('password_hash = $' + i); params.push(await hashPassword(password));
      }
      if (updates.length === 0) return res.status(422).json({ error: '没有需要更新的字段' });
      params.push(uid);
      const result = await pool.query('UPDATE users SET ' + updates.join(', ') + ' WHERE id = $' + (params.length) + ' RETURNING id, username, display_name, role, avatar_url', params);
      if (result.rows.length === 0) return res.status(404).json({ error: '用户不存在' });
      const u = result.rows[0];
      invalidateBannedCache(uid);
      res.json({ user: { id: u.id, username: u.username, displayName: u.display_name, role: u.role, avatarUrl: u.avatar_url || null } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // PATCH /api/v1/users/:id/ban — 封禁/解封
  app.patch('/api/v1/users/:id/ban', requireAdmin, async (req, res) => {
    try {
      const uid = parseInt(req.params.id);
      const { banned } = req.body;
      if (typeof banned !== 'boolean') return res.status(422).json({ error: '缺少 banned 字段' });
      const ur = await pool.query('SELECT id, username, is_banned FROM users WHERE id = $1', [uid]);
      if (ur.rows.length === 0) return res.status(404).json({ error: '用户不存在' });
      const u = ur.rows[0];
      await pool.query('UPDATE users SET is_banned = $1 WHERE id = $2', [banned, uid]);
      invalidateBannedCache(uid);
      if (banned) addToBlacklist(String(uid));
      res.json({ user: { id: u.id, username: u.username, isBanned: banned }, message: (banned ? '已封禁' : '已解封') + '用户 ' + u.username });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
};
