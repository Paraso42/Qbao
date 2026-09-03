// ============================================================
// noticesApi.js — 公告接口封装（自 legacy notices.js 迁移）
// 公开端点无需认证；管理员端仅封装（用户中心代理负责 UI）。
// ============================================================
import { API_BASE } from '../core/env'

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

// GET /notices/all — 管理员全部消息由 usersApi.getAllNotices 提供（P2.3 清理死代码 getAdminNotices）
