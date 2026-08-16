// ============================================================
// filesApi.js — 文件池 API（自 legacy users.js 文件管理部分迁移）
// 上传用 FormData（file + chapterId）；错误统一 readApiError 取中文 message。
// ============================================================
import { fetchWithAuth, readApiError } from './api'

async function _handle(res, fallback) {
  if (!res) throw new Error(fallback || '请求失败，请检查网络')
  if (!res.ok) throw new Error(await readApiError(res, fallback))
  return res.json().catch(() => ({}))
}

// POST /files/upload  FormData: file + chapterId(可选)
export async function uploadFile(file, chapterId) {
  const form = new FormData()
  form.append('file', file)
  if (chapterId) form.append('chapterId', chapterId)
  return _handle(await fetchWithAuth('/files/upload', { method: 'POST', body: form }), '上传失败')
}

// GET /files?pool=true|false&chapter_id=
export async function listFiles({ pool, chapterId } = {}) {
  const qs = new URLSearchParams()
  if (pool !== undefined && pool !== null) qs.set('pool', pool ? 'true' : 'false')
  if (chapterId) qs.set('chapter_id', chapterId)
  const q = qs.toString()
  return _handle(await fetchWithAuth('/files' + (q ? '?' + q : '')), '加载文件失败')
}

// DELETE /files/:id
export async function deleteFile(id) {
  return _handle(await fetchWithAuth('/files/' + id, { method: 'DELETE' }), '删除失败')
}

// POST /files/:id/assign  { chapterId }
export async function assignFile(id, chapterId) {
  return _handle(await fetchWithAuth('/files/' + id + '/assign', { method: 'POST', body: JSON.stringify({ chapterId }) }), '分配失败')
}

// POST /files/:id/unassign
export async function unassignFile(id) {
  return _handle(await fetchWithAuth('/files/' + id + '/unassign', { method: 'POST' }), '移除失败')
}

// POST /files/:id/extend
export async function extendFile(id) {
  return _handle(await fetchWithAuth('/files/' + id + '/extend', { method: 'POST' }), '续期失败')
}

// —— 展示辅助（纯逻辑，同 legacy） ——
export function formatDuration(ms) {
  if (ms <= 0) return '已过期'
  const d = Math.floor(ms / 86400000)
  if (d > 0) return d + ' 天'
  const h = Math.floor((ms % 86400000) / 3600000)
  if (h > 0) return h + ' 小时'
  const m = Math.floor((ms % 3600000) / 60000)
  return m + ' 分钟'
}

export function fileIconFor(mimeType) {
  if (/pdf/.test(mimeType)) return '📄'
  if (/word|doc/.test(mimeType)) return '📝'
  if (/presentation|ppt/.test(mimeType)) return '📊'
  if (/image/.test(mimeType)) return '🖼️'
  if (/text|markdown/.test(mimeType)) return '📃'
  return '📎'
}
