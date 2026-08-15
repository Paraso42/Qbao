// bcryptjs：纯 JS 实现，与 bcrypt 的 $2b$ 哈希格式互通，免原生编译（本地/CI/服务器一致）。
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const SALT_ROUNDS = 10;
const JWT_EXPIRES = '30d';

const ADMIN_USERNAMES = (process.env.ADMIN_USERNAMES || '').split(',').map(s => s.trim()).filter(Boolean);

async function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

async function comparePassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

function isAdminUsername(username) {
  return ADMIN_USERNAMES.includes(username);
}

function signToken(userId, role) {
  return jwt.sign({ sub: userId, role: role || 'user' }, process.env.JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (e) {
    return null;
  }
}

module.exports = { hashPassword, comparePassword, signToken, verifyToken, isAdminUsername };
