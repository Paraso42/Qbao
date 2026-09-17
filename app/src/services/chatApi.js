// ============================================================
// chatApi.js — 聊天 API 封装（自 legacy chat.js 迁移）
// rooms / friends / requests / messages / upload / updates /
// revoke / update-quiz / search，全部基于 fetchWithAuth。
// /chat/upload 使用 FormData 'file' 字段；错误统一 readApiError。
// ============================================================
import { fetchWithAuth, readApiError, readApiErrorSafe, effectiveToken, getToken, clearStoredAuth } from './api'
import { API_BASE } from '../core/env'

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
//
// v3.37.5：改用 XHR，只为拿到 upload.onprogress —— fetch 无法报告上传进度，
// 而图片原图动辄数 MB，上行慢时界面会「一动不动」，用户以为卡死。
// onProgress 收到 0~100 的整数百分比（无法计算总长时收到 -1）。
// 401 处理与 fetchWithAuth 保持一致：本页令牌仍有效才清登出（避免把别的标签页登出）。
// v3.37.6：可选 opts.thumb —— 列表用的小图，和主图同一次请求上传（字段名 thumb）。
// 服务端存成 <主图名>.w480.<ext>，列表用 ?w=480 取它，点开才取原图。
export function uploadFile(file, opts) {
  const o = opts || {}
  const onProgress = typeof o.onProgress === 'function' ? o.onProgress : null
  const thumb = o.thumb || null
  const appendAll = (fd) => {
    fd.append('file', file)
    if (thumb) fd.append('thumb', thumb, thumb.name || 'thumb.webp')
  }
  return new Promise((resolve, reject) => {
    const formData = new FormData()
    appendAll(formData)
    let xhr
    try {
      xhr = new XMLHttpRequest()
    } catch {
      // 极端环境（无 XHR）回退 fetch，功能不受影响
      const fd = new FormData()
      appendAll(fd)
      fetchWithAuth('/chat/upload', { method: 'POST', body: fd })
        .then(async (res) => {
          if (!res || !res.ok) throw new Error(await readApiError(res, '上传失败'))
          resolve(await res.json())
        })
        .catch(reject)
      return
    }
    xhr.open('POST', API_BASE + '/chat/upload')
    const tok = effectiveToken()
    if (tok) xhr.setRequestHeader('Authorization', 'Bearer ' + tok)
    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e && e.lengthComputable && e.total > 0) {
          onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)))
        } else {
          onProgress(-1)
        }
      }
    }
    xhr.onload = async () => {
      if (xhr.status === 401) {
        if (!tok || tok === getToken()) clearStoredAuth()
        reject(new Error('登录已过期，请重新登录'))
        return
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText || '{}')) } catch { reject(new Error('上传响应解析失败')) }
        return
      }
      // 复用统一的错误文案提取：伪造一个最小的 Response 形状
      const fake = {
        ok: false,
        status: xhr.status,
        json: async () => { try { return JSON.parse(xhr.responseText || '{}') } catch { return {} } },
        text: async () => xhr.responseText || '',
      }
      let msg = '上传失败'
      try {
        msg = await readApiErrorSafe(fake, '上传失败')
      } catch { /* 保底文案 */ }
      reject(new Error(msg))
    }
    xhr.onerror = () => reject(new Error('网络中断，上传失败'))
    xhr.ontimeout = () => reject(new Error('上传超时，请重试'))
    xhr.onabort = () => reject(new Error('上传已取消'))
    try { xhr.send(formData) } catch (e) { reject(new Error('上传失败: ' + (e.message || '未知错误'))) }
  })
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
