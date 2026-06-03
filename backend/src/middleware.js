const { verifyToken } = require('./auth');
const { pool } = require('./db');

// Token 黑名单（内存实现，PM2 重启后清空）
// 存储格式: Map<tokenId, expireAt_timestamp>
const tokenBlacklist = new Map();

// 每 10 分钟清理过期黑名单条目
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [id, expireAt] of tokenBlacklist) {
    if (expireAt <= now) { tokenBlacklist.delete(id); cleaned++; }
  }
  if (cleaned > 0) console.log('tokenBlacklist cleanup: removed ' + cleaned + ' expired tokens');
}, 10 * 60 * 1000);

// 封禁缓存：userId -> { banned: boolean, expires: timestamp }
// 5 分钟 TTL，避免每个请求查数据库
const bannedCache = new Map();
const BANNED_CACHE_TTL = 5 * 60 * 1000;

function isBlacklisted(tokenId) {
  return tokenBlacklist.has(tokenId);
}

function addToBlacklist(tokenId) {
  // JWT 默认 30 天过期，黑名单也设同样时长
  tokenBlacklist.set(tokenId, Date.now() + 30 * 24 * 3600 * 1000);
}

async function isUserBanned(userId) {
  const cached = bannedCache.get(userId);
  if (cached && cached.expires > Date.now()) return cached.banned;
  try {
    const result = await pool.query('SELECT is_banned FROM users WHERE id = $1', [userId]);
    if (result.rows.length > 0) {
      const banned = result.rows[0].is_banned;
      bannedCache.set(userId, { banned, expires: Date.now() + BANNED_CACHE_TTL });
      return banned;
    }
  } catch (e) {
    console.warn('isUserBanned check failed:', e.message);
  }
  return false;
}

function invalidateBannedCache(userId) {
  bannedCache.delete(userId);
}

// 异步更新用户活跃时间（不阻塞请求）
function updateLastActive(userId) {
  pool.query('UPDATE users SET last_active_at = NOW() WHERE id = $1', [userId])
    .catch(() => {});
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录' });
  }
  const token = header.slice(7);
  const decoded = verifyToken(token);
  if (!decoded) return res.status(401).json({ error: 'Token 无效或已过期' });

  // 黑名单检查
  const tokenId = token.substring(0, 20);
  if (isBlacklisted(tokenId)) {
    return res.status(401).json({ error: 'Token 已被撤销，请重新登录' });
  }

  req.userId = decoded.sub;
  req.userRole = decoded.role || 'user';

  // 管理员豁免封禁检查
  if (req.userRole !== 'admin') {
    isUserBanned(req.userId).then(banned => {
      if (banned && !res.headersSent) {
        res.status(403).json({ error: '账号已被封禁' });
      }
    });
  }

  // 异步更新活跃时间
  updateLastActive(req.userId);

  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, function () {
    if (req.userRole !== 'admin') {
      return res.status(403).json({ error: '需要管理员权限' });
    }
    next();
  });
}

module.exports = { requireAuth, requireAdmin, addToBlacklist, invalidateBannedCache };
