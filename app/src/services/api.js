// ============================================================
// api.js — 认证与请求封装（自 legacy api.js 迁移）
// token 存放（v3.31 P1.3 加固）：桌面端走主进程 safeStorage（renderer 无明文持久化），
// 网页端最小混淆；旧明文键自动兼容并迁移。登录态由 user store 维护。
// ============================================================
import { API_BASE, IS_DESKTOP, desktopBridge } from '../core/env'
import { obfuscate, deobfuscate, secretNameFor } from './secureStore'

// 桌面端 token 内存镜像（IPC 为异步，同步读取走内存；boot 时 initSecureAuth 预热）
let _memToken = null

export async function initSecureAuth() {
  if (!IS_DESKTOP) return
  const b = desktopBridge()
  if (!b) return
  try {
    const r = await b.secretLoad(secretNameFor('token', ''))
    if (r && r.ok && r.value) {
      _memToken = r.value
      try { localStorage.removeItem('qbao_token') } catch (e) {}
      return
    }
  } catch (e) {}
  // 升级迁移：旧 localStorage 明文/混淆 → 安全存储，然后清明文
  try {
    const legacy = localStorage.getItem('qbao_token')
    if (legacy) {
      const plain = deobfuscate(legacy)
      if (plain !== null && plain !== undefined && plain.length) {
        _memToken = plain
        b.secretSave(secretNameFor('token', ''), plain).catch(() => {})
        try { localStorage.removeItem('qbao_token') } catch (e) {}
      }
    }
  } catch (e) {}
}

export function getToken() {
  if (IS_DESKTOP) {
    if (_memToken !== null) return _memToken
    try {
      const raw = localStorage.getItem('qbao_token')
      if (!raw) return null
      const plain = deobfuscate(raw)
      return plain !== null && plain !== undefined && plain.length ? plain : null
    } catch (e) { return null }
  }
  try {
    const raw = localStorage.getItem('qbao_token')
    if (!raw) return null
    const plain = deobfuscate(raw)
    return plain !== null && plain !== undefined && plain.length ? plain : null
  } catch (e) { return null }
}

export function setToken(t) {
  if (IS_DESKTOP) {
    _memToken = t || null
    const b = desktopBridge()
    if (!b) return
    if (t) {
      b.secretSave(secretNameFor('token', ''), t)
        .then((r) => { if (!r || !r.ok) legacyTokenFallback(t) })
        .catch(() => legacyTokenFallback(t))
    } else {
      b.secretRemove(secretNameFor('token', '')).catch(() => {})
      try { localStorage.removeItem('qbao_token') } catch (e) {}
    }
    return
  }
  try {
    if (t) localStorage.setItem('qbao_token', obfuscate(t))
    else localStorage.removeItem('qbao_token')
  } catch (e) {}
}

// 桌面 safeStorage 不可用时的降级（混淆写 localStorage，功能不中断）
function legacyTokenFallback(t) {
  try {
    if (t) localStorage.setItem('qbao_token', obfuscate(t))
    else localStorage.removeItem('qbao_token')
  } catch (e) {}
}
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
  if (options.keepalive) fetchOpts.keepalive = true // T10: 页面关闭前尽力推送
  const res = await fetch(API_BASE + path, fetchOpts)
  if (res.status === 401) { clearStoredAuth(); return null }
  return res
}

export function netErrorMessage() {
  return (IS_DESKTOP)
    ? '无法连接服务器 (' + API_BASE + ') — 请检查网络连接或 VPN'
    : '无法连接服务器 (' + API_BASE + ') — 请检查网络'
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