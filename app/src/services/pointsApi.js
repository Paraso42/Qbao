// ============================================================
// pointsApi.js — 积分系统 API（v3.29）
// 与 usersApi/filesApi 同构：fetchWithAuth + readApiError。
// ============================================================
import { fetchWithAuth, readApiError } from './api'

async function _handle(res, fallback) {
  if (!res) throw new Error(fallback || '请求失败，请检查网络')
  if (!res.ok) throw new Error(await readApiError(res, fallback))
  return res.json().catch(() => ({}))
}

// GET /points/ledger?page=&limit=&reason=
export async function getLedger(params = {}) {
  const qs = new URLSearchParams()
  if (params.page) qs.set('page', String(params.page))
  if (params.limit) qs.set('limit', String(params.limit))
  if (params.reason) qs.set('reason', params.reason)
  const q = qs.toString()
  return _handle(await fetchWithAuth('/points/ledger' + (q ? '?' + q : '')), '获取积分明细失败')
}

// GET /points/balance
export async function getBalance() {
  return _handle(await fetchWithAuth('/points/balance'), '获取积分余额失败')
}

// GET /points/rules — 静态规则 + 学期清零信息
export async function getRules() {
  return _handle(await fetchWithAuth('/points/rules'), '获取积分规则失败')
}

// GET /points/quota — 今日 AI 配额
export async function getQuota() {
  return _handle(await fetchWithAuth('/points/quota'), '获取 AI 配额失败')
}

// POST /points/claims { type:'achievement', refId }
export async function claimAchievement(refId) {
  return _handle(await fetchWithAuth('/points/claims', {
    method: 'POST',
    body: JSON.stringify({ type: 'achievement', refId })
  }), '领取成就奖励失败')
}

// —— 管理员 ——
// GET /users/:id/points/ledger
export async function adminGetUserLedger(id, params = {}) {
  const qs = new URLSearchParams()
  if (params.page) qs.set('page', String(params.page))
  if (params.limit) qs.set('limit', String(params.limit))
  const q = qs.toString()
  return _handle(await fetchWithAuth('/users/' + id + '/points/ledger' + (q ? '?' + q : '')), '获取用户积分明细失败')
}

// POST /users/:id/points/adjust { delta, note }
export async function adminAdjustPoints(id, delta, note) {
  return _handle(await fetchWithAuth('/users/' + id + '/points/adjust', {
    method: 'POST',
    body: JSON.stringify({ delta, note })
  }), '积分调整失败')
}
