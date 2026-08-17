// ============================================================
// chatApi.js — 聊天 API 封装（自 legacy chat.js 迁移）
// rooms / friends / requests / messages / upload / updates /
// revoke / update-quiz / search，全部基于 fetchWithAuth。
// /chat/upload 使用 FormData 'file' 字段；错误统一 readApiError。
// ============================================================
import { fetchWithAuth, readApiError } from './api'

// —— 会话 ——
export async function getRooms() {
  const res = await fetchWithAuth('/chat/rooms')
  if (!res || !res.ok) throw new Error(await readApiError(res, '加载会话失败'))
  const data = await res.json()
  return data.rooms || []
}

// 创建单聊（POST /chat/rooms { type:'direct', friendId }）
export async function createDirectRoom(friendId) {
  const res = await fetchWithAuth('/chat/rooms', {
    method: 'POST',
    body: JSON.stringify({ type: 'direct', friendId })
  })
  if (!res || !res.ok) throw new Error(await readApiError(res, '创建会话失败'))
  return res.json()
}

// 创建群聊（POST /chat/rooms { type:'group', name, memberIds }）
export async function createGroupRoom(name, memberIds) {
  const res = await fetchWithAuth('/chat/rooms', {
    method: 'POST',
    body: JSON.stringify({ type: 'group', name, memberIds })
  })
  if (!res || !res.ok) throw new Error(await readApiError(res, '创建失败'))
  return res.json()
}

// —— 消息 ——
export async function getMessages(roomId) {
  const res = await fetchWithAuth('/chat/rooms/' + roomId + '/messages?limit=50')
  if (!res || !res.ok) throw new Error(await readApiError(res, '加载消息失败'))
  const data = await res.json()
  return data.messages || []
}

// POST body 含 content/images/file_info/msg_type/quiz_data/reply_to
export async function sendMessage(roomId, body) {
  // 只发送有值的字段：避免 file_info/quiz_data 等以 null 提交被后端 zod 拒绝
  const clean = {}
  for (const k in body) {
    const v = body[k]
    if (v === null || v === undefined) continue
    if (Array.isArray(v) && v.length === 0 && k === 'images') continue
    clean[k] = v
  }
  const res = await fetchWithAuth('/chat/rooms/' + roomId + '/messages', {
    method: 'POST',
    body: JSON.stringify(clean)
  })
  if (!res || !res.ok) throw new Error(await readApiError(res, '发送失败'))
  return res.json()
}

// 上传文件/图片（FormData 'file' 字段）→ { url, name, size, mimeType }
export async function uploadFile(file) {
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetchWithAuth('/chat/upload', { method: 'POST', body: formData })
  if (!res || !res.ok) throw new Error(await readApiError(res, '上传失败'))
  return res.json()
}

export async function getUpdates() {
  const res = await fetchWithAuth('/chat/updates')
  if (!res || !res.ok) throw new Error(await readApiError(res, '获取更新失败'))
  return res.json()
}

export async function markRead(roomId) {
  const res = await fetchWithAuth('/chat/rooms/' + roomId + '/read', { method: 'POST' })
  if (!res || !res.ok) throw new Error(await readApiError(res, '标记已读失败'))
  return res.json()
}

export async function revokeMessage(msgId) {
  const res = await fetchWithAuth('/chat/messages/' + msgId + '/revoke', { method: 'POST' })
  if (!res || !res.ok) throw new Error(await readApiError(res, '撤回失败'))
  return res.json()
}

export async function updateQuizMessage(msgId, quizData) {
  const res = await fetchWithAuth('/chat/messages/' + msgId + '/update-quiz', {
    method: 'POST',
    body: JSON.stringify({ quiz_data: quizData })
  })
  if (!res || !res.ok) throw new Error(await readApiError(res, '提交失败'))
  return res.json()
}

// —— 好友 / 申请 ——
export async function getFriends() {
  const res = await fetchWithAuth('/chat/friends')
  if (!res || !res.ok) throw new Error(await readApiError(res, '加载好友失败'))
  const data = await res.json()
  return data.friends || []
}

export async function getFriendRequests() {
  const res = await fetchWithAuth('/chat/friends/requests')
  if (!res || !res.ok) throw new Error(await readApiError(res, '加载申请失败'))
  const data = await res.json()
  return data.requests || []
}

export async function sendFriendRequest(friendId, message) {
  const res = await fetchWithAuth('/chat/friends/request', {
    method: 'POST',
    body: JSON.stringify({ friendId, message: message || '' })
  })
  if (!res || !res.ok) throw new Error(await readApiError(res, '发送失败'))
  return res.json()
}

export async function acceptFriendRequest(requestId) {
  const res = await fetchWithAuth('/chat/friends/requests/' + requestId + '/accept', { method: 'POST' })
  if (!res || !res.ok) throw new Error(await readApiError(res, '操作失败'))
  return res.json()
}

export async function rejectFriendRequest(requestId) {
  const res = await fetchWithAuth('/chat/friends/requests/' + requestId + '/reject', { method: 'POST' })
  if (!res || !res.ok) throw new Error(await readApiError(res, '操作失败'))
  return res.json()
}

export async function deleteFriend(friendId) {
  const res = await fetchWithAuth('/chat/friends/' + friendId, { method: 'DELETE' })
  if (!res || !res.ok) throw new Error(await readApiError(res, '删除失败'))
  return res.json()
}

// —— 搜索 / 群成员 ——
export async function searchUsers(q) {
  const res = await fetchWithAuth('/chat/users/search?q=' + encodeURIComponent(q))
  if (!res || !res.ok) throw new Error(await readApiError(res, '搜索失败'))
  const data = await res.json()
  return data.users || []
}

export async function addMembers(roomId, userIds) {
  const res = await fetchWithAuth('/chat/rooms/' + roomId + '/add-members', {
    method: 'POST',
    body: JSON.stringify({ userIds })
  })
  if (!res || !res.ok) throw new Error(await readApiError(res, '邀请失败'))
  return res.json()
}

export async function leaveRoom(roomId) {
  const res = await fetchWithAuth('/chat/rooms/' + roomId + '/leave', { method: 'POST' })
  if (!res || !res.ok) throw new Error(await readApiError(res, '退出失败'))
  return res.json()
}
