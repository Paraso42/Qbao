const bcrypt = require('bcrypt');
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
