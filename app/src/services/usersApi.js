// ============================================================
// usersApi.js — 用户/管理员/公告 API（自 legacy users.js + notices.js 迁移）
// 所有请求经 fetchWithAuth（自动带 Bearer），错误统一 readApiError 取中文 message。
// ============================================================
import { fetchWithAuth, readApiError } from './api'

// 头像 base64 dataURL 上限 5MB（服务端同样校验，客户端先拦）
const MAX_AVATAR_BYTES = 5 * 1024 * 1024

// 统一处理：网络失败(401→null) 与业务错误(非2xx→读取{error})
async function _handle(res, fallback) {
  if (!res) throw new Error(fallback || '请求失败，请检查网络')
  if (!res.ok) throw new Error(await readApiError(res, fallback))
  return res.json().catch(() => ({}))
}

// 近似计算 base64 dataURL 的实际字节数（去掉 data:...;base64, 前缀）
function _base64Bytes(dataUrl) {
  const idx = dataUrl.indexOf(',')
  const b64 = idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.floor(b64.length * 3 / 4) - padding
}

// GET /users/me
export async function getMe() {
  return _handle(await fetchWithAuth('/users/me'), '获取用户信息失败')
}

// PUT /users/me  { displayName, password?, newPassword? }
export async function updateMe(body) {
  return _handle(await fetchWithAuth('/users/me', { method: 'PUT', body: JSON.stringify(body) }), '保存失败')
}

// PUT /users/me/avatar  { avatar: dataURL }
export async function uploadAvatar(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.indexOf('data:') !== 0) throw new Error('头像数据无效')
  if (_base64Bytes(dataUrl) > MAX_AVATAR_BYTES) throw new Error('头像图片不能超过 5MB')
  return _handle(await fetchWithAuth('/users/me/avatar', { method: 'PUT', body: JSON.stringify({ avatar: dataUrl }) }), '头像上传失败')
}

// GET /users?search=&role=&page=&limit=
export async function getUsers(params = {}) {
  const qs = new URLSearchParams()
  if (params.search) qs.set('search', params.search)
  if (params.role) qs.set('role', params.role)
  if (params.page) qs.set('page', String(params.page))
  if (params.limit) qs.set('limit', String(params.limit))
  const q = qs.toString()
  return _handle(await fetchWithAuth('/users' + (q ? '?' + q : '')), '获取用户列表失败')
}

// GET /users/stats
export async function getUsersStats() {
  return _handle(await fetchWithAuth('/users/stats'), '获取用户统计失败')
}

// GET /users/:id
export async function getUser(id) {
  return _handle(await fetchWithAuth('/users/' + id), '获取用户信息失败')
}

// PUT /users/:id
export async function updateUser(id, body) {
  return _handle(await fetchWithAuth('/users/' + id, { method: 'PUT', body: JSON.stringify(body) }), '操作失败')
}

// PATCH /users/:id/ban  { banned }
export async function setUserBan(id, banned) {
  return _handle(await fetchWithAuth('/users/' + id + '/ban', { method: 'PATCH', body: JSON.stringify({ banned: !!banned }) }), '操作失败')
}

// ===== 公告管理（admin） =====
// GET /notices/all
export async function getAllNotices() {
  return _handle(await fetchWithAuth('/notices/all'), '获取公告失败')
}
// POST /notices  { content, type, link?, expire_at?, duration }
export async function createNotice(body) {
  return _handle(await fetchWithAuth('/notices', { method: 'POST', body: JSON.stringify(body) }), '保存失败')
}
// PUT /notices/:id
export async function updateNotice(id, body) {
  return _handle(await fetchWithAuth('/notices/' + id, { method: 'PUT', body: JSON.stringify(body) }), '保存失败')
}
// PATCH /notices/:id/toggle
export async function toggleNotice(id) {
  return _handle(await fetchWithAuth('/notices/' + id + '/toggle', { method: 'PATCH' }), '操作失败')
}
// DELETE /notices/:id
export async function deleteNotice(id) {
  return _handle(await fetchWithAuth('/notices/' + id, { method: 'DELETE' }), '删除失败')
}
