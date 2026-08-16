// ============================================================
// issuesApi.js — Issue/反馈接口封装（自 legacy feedback.js 迁移）
// 所有写操作带认证；错误统一 throw Error(中文文案)，由 store 捕获后 toast。
// ============================================================
import { fetchWithAuth, readApiError } from './api'

// 统一请求：带认证 fetch + 错误解析，成功返回解析后的 JSON
async function request(path, opts = {}, fallback = '操作失败') {
  let res
  try {
    res = await fetchWithAuth(path, opts)
  } catch (e) {
    throw new Error('网络错误，请稍后重试')
  }
  if (!res) throw new Error('请先登录')
  if (!res.ok) throw new Error(await readApiError(res, fallback))
  return res.json()
}

// POST /issues { title, content }
export function createIssue(title, content) {
  return request('/issues', { method: 'POST', body: JSON.stringify({ title, content }) }, '提交失败')
}

// GET /issues — 我的工单列表
export function getIssues() {
  return request('/issues', { method: 'GET' }, '获取反馈列表失败')
}

// GET /issues/updates — 轮询（未读计数 + 近期变更的 issue id）
export function getIssueUpdates() {
  return request('/issues/updates', { method: 'GET' }, '获取更新失败')
}

// GET /issues/:id — 工单详情（含消息列表）
export function getIssue(id) {
  return request('/issues/' + id, { method: 'GET' }, '加载失败')
}

// PUT /issues/:id { title } — 重命名标题
export function renameIssue(id, title) {
  return request('/issues/' + id, { method: 'PUT', body: JSON.stringify({ title }) }, '重命名失败')
}

// POST /issues/:id/messages { content, images }
export function sendIssueMessage(id, content, images) {
  return request('/issues/' + id + '/messages', { method: 'POST', body: JSON.stringify({ content, images }) }, '发送失败')
}

// PATCH /issues/:id/status { status, reason }
export function updateIssueStatus(id, status, reason) {
  const body = { status }
  if (reason) body.reason = reason
  return request('/issues/' + id + '/status', { method: 'PATCH', body: JSON.stringify(body) }, '操作失败')
}

// DELETE /issues/:id — 管理员删除（backend 保护 closed 不可删）
export function deleteIssue(id) {
  return request('/issues/' + id, { method: 'DELETE' }, '删除失败')
}

// GET /issues/admin — 管理员全部工单（按状态排序）
export function getAdminIssues() {
  return request('/issues/admin', { method: 'GET' }, '获取反馈列表失败')
}

// POST /issues/upload — FormData 'image' 字段，返回 { url, name, size }
export async function uploadIssueImage(file, filename) {
  const formData = new FormData()
  formData.append('image', file, filename || (file && file.name) || undefined)
  let res
  try {
    res = await fetchWithAuth('/issues/upload', { method: 'POST', body: formData })
  } catch (e) {
    throw new Error('图片上传失败，请重试')
  }
  if (!res) throw new Error('请先登录')
  if (!res.ok) throw new Error(await readApiError(res, '图片上传失败，请重试'))
  return res.json()
}
