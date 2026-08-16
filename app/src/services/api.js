// ============================================================
// api.js — 认证与请求封装（自 legacy api.js 迁移）
// token/user 存 localStorage（键不变），登录态由 user store 维护。
// ============================================================
import { API_BASE, IS_DESKTOP, desktopBridge } from '../core/env'

export function getToken() { return localStorage.getItem('qbao_token') }
export function setToken(t) { if (t) localStorage.setItem('qbao_token', t); else localStorage.removeItem('qbao_token') }
export function getStoredUser() {
  try { return JSON.parse(localStorage.getItem('qbao_user') || 'null') } catch { return null }
}
export function setStoredUser(u) { if (u) localStorage.setItem('qbao_user', JSON.stringify(u)); else localStorage.removeItem('qbao_user') }

export function clearStoredAuth() { setToken(null); setStoredUser(null) }

export async function fetchWithAuth(path, options = {}) {
  const isFormData = options.body instanceof FormData
  const headers = isFormData ? {} : { 'Content-Type': 'application/json' }
  if (options.headers) Object.assign(headers, options.headers)
  if (getToken()) headers['Authorization'] = 'Bearer ' + getToken()
  const fetchOpts = { method: options.method, headers }
  if (options.body) fetchOpts.body = options.body
  if (options.signal) fetchOpts.signal = options.signal
  const res = await fetch(API_BASE + path, fetchOpts)
  if (res.status === 401) { clearStoredAuth(); return null }
  return res
}

export function netErrorMessage() {
  return (IS_DESKTOP)
    ? '无法连接服务器 (' + API_BASE + ') — 请检查网络连接或 VPN'
    : '无法连接服务器 (' + API_BASE + ') — 请检查网络'
}

// 桌面端首次运行：未配置服务器时引导输入地址（应用内保存，主进程重建窗口生效）
export function showServerSetupDialog() {
  const bridge = desktopBridge()
  if (!bridge || typeof bridge.setServer !== 'function') return
  const url = window.prompt('设置服务器地址（如 http://114.55.210.82）', 'http://')
  if (url == null) return
  const trimmed = String(url).trim()
  if (!/^https?:\/\//.test(trimmed)) { window.alert('请输入完整地址，如 http://114.55.210.82'); return }
  bridge.setServer(trimmed, '服务器')
    .then((r) => { if (r && r.ok !== false) return; window.alert('保存失败: ' + ((r && r.error) || '未知错误')) })
    .catch((e) => window.alert('保存失败: ' + e.message))
}

// 登录/注册：仅网络请求，返回 { token, user }；登录态由调用方写入。
export async function apiLogin(username, password) {
  let res
  try {
    res = await fetch(API_BASE + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    })
  } catch (e) { throw new Error(netErrorMessage()) }
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    throw new Error(e.error || '登录失败')
  }
  return res.json()
}

export async function apiRegister(username, displayName, password) {
  let res
  try {
    res = await fetch(API_BASE + '/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, displayName: displayName || username, password })
    })
  } catch (e) { throw new Error(netErrorMessage()) }
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    throw new Error(e.error || '注册失败')
  }
  return res.json()
}

// 统一读取接口错误信息（zod 422 / ApiError 均返回 { error }）
export async function readApiError(res, fallback) {
  try {
    const data = await res.json()
    return (data && data.error) || fallback
  } catch (e) { return fallback }
}
