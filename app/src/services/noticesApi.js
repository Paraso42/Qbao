// ============================================================
// noticesApi.js — 公告接口封装（自 legacy notices.js 迁移）
// 公开端点无需认证；管理员端仅封装（用户中心代理负责 UI）。
// ============================================================
import { API_BASE } from '../core/env'
import { fetchWithAuth, readApiError } from './api'

// GET /notices — 公开公告（已启用、未过期）；失败返回 []（静默，同 legacy loadNotices）
export async function getNotices() {
  let res
  try {
    res = await fetch(API_BASE + '/notices')
  } catch (e) {
    return []
  }
  if (!res.ok) return []
  return res.json()
}

// GET /notices/all — 管理员全部消息（含停用/过期）
export async function getAdminNotices() {
  let res
  try {
    res = await fetchWithAuth('/notices/all', { method: 'GET' })
  } catch (e) {
    throw new Error('网络错误，请稍后重试')
  }
  if (!res) throw new Error('请先登录')
  if (!res.ok) throw new Error(await readApiError(res, '获取消息失败'))
  return res.json()
}
