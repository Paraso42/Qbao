// ============================================================
// sync.js — 双形态同步层（v3.25 语义不变，模块化版）
// 职责：带 rev 乐观锁的全量同步、409 冲突合并、失败可见化与自动重试。
// 引擎与 UI/store 解耦：createSyncEngine(ctx) 注入上下文。
// ============================================================
import { fetchWithAuth, getToken, getStoredUser } from './api'
import { stripAiSecretsFromState } from './aiKeys'
import { migrateState, STORAGE_KEY, CLOUD_STORAGE_PREFIX } from './persistence'

export const SYNC_PENDING_KEY = 'qbao_sync_pending'
const LAST_SYNC_KEY = 'qbao_lastSync'

export function getSyncPending() {
  try { return localStorage.getItem(SYNC_PENDING_KEY) === '1' } catch (e) { return false }
}
export function setSyncPending(v) {
  try { if (v) localStorage.setItem(SYNC_PENDING_KEY, '1'); else localStorage.removeItem(SYNC_PENDING_KEY) } catch (e) {}
}
export function getLastSyncAt() {
  const v = localStorage.getItem(LAST_SYNC_KEY)
  return v ? new Date(v).getTime() : null
}

// 合并策略（v1）：实体级并集，同 id 本地优先，云端独有实体保留——任何一侧数据都不丢。
export function mergeStates(localState, cloudState) {
  const m = JSON.parse(JSON.stringify(cloudState || {}))
  const L = localState || {}
  ;['currentSubjectId', 'currentChapterId', 'currentExamId', 'lastScreen', 'darkMode',
    'aiConfig', 'settings', 'userSettings', 'notices'].forEach(function (k) {
    if (typeof L[k] !== 'undefined' && L[k] !== null) m[k] = L[k]
  })
  ;['subjects', 'chapters', 'generatedExams', 'srsData'].forEach(function (k) {
    const c = m[k] || {}
    const l = L[k] || {}
    Object.keys(l).forEach(function (id) { c[id] = l[id] })
    m[k] = c
  })
  if (Array.isArray(L.history) && Array.isArray(m.history)) {
    const have = {}
    m.history.forEach(function (h) { if (h && h.id) have[h.id] = true })
    L.history.forEach(function (h) { if (h && h.id && !have[h.id]) m.history.push(h) })
  } else if (Array.isArray(L.history)) {
    m.history = L.history
  }
  return m
}

export function persistMergedState(merged) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
  const user = getStoredUser()
  if (user && user.id) localStorage.setItem(CLOUD_STORAGE_PREFIX + user.id, JSON.stringify(merged))
}

// ctx: {
//   getState() -> 当前 state（data store 的 reactive state）
//   replaceState(merged) -> 合并后替换 store 状态（保持响应性）
//   isOnline() -> 是否在线登录
//   onStatus({ pending, syncing, lastSyncAt }) -> 更新同步指示
//   notify(msg) -> toast
// }
export function createSyncEngine(ctx) {
  let _syncRev = null
  let _syncInFlight = false
  let _syncTimer = null
  let _syncRetryTimer = null

  function updateStatus() {
    if (ctx.onStatus) {
      ctx.onStatus({
        pending: getSyncPending(),
        syncing: _syncInFlight,
        lastSyncAt: getLastSyncAt()
      })
    }
  }

  function markSynced() {
    setSyncPending(false)
    localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString())
    updateStatus()
  }

  async function flushSync() {
    if (_syncInFlight || !ctx.isOnline() || !getToken()) return
    _syncInFlight = true
    updateStatus()
    try {
      stripAiSecretsFromState(ctx.getState())
      const body = { state_json: ctx.getState() }
      if (_syncRev) body.rev = _syncRev
      const res = await fetchWithAuth('/data', { method: 'PUT', body: JSON.stringify(body) })
      if (!res) { setSyncPending(false); updateStatus(); return } // 401 → 已登出
      if (res.ok) {
        const data = await res.json().catch(() => ({}))
        if (typeof data.rev === 'number') _syncRev = data.rev
        markSynced()
      } else if (res.status === 409) {
        console.warn('[sync] 409 conflict, merging with cloud')
        const cur = await fetchWithAuth('/data')
        if (cur && cur.ok) {
          const cloud = await cur.json().catch(() => null)
          if (cloud && cloud.state_json) {
            const merged = mergeStates(ctx.getState(), migrateState(cloud.state_json))
            ctx.replaceState(merged)
            persistMergedState(merged)
            if (typeof cloud.rev === 'number') _syncRev = cloud.rev
            if (ctx.notify) ctx.notify('检测到其他设备的数据，已自动合并')
          }
          if (typeof _syncRev === 'number' && _syncRev > 0) {
            stripAiSecretsFromState(ctx.getState())
            const body2 = { state_json: ctx.getState(), rev: _syncRev }
            const res2 = await fetchWithAuth('/data', { method: 'PUT', body: JSON.stringify(body2) })
            if (res2 && res2.ok) {
              const d2 = await res2.json().catch(() => ({}))
              if (typeof d2.rev === 'number') _syncRev = d2.rev
              markSynced()
              return
            }
          }
        }
        setSyncPending(true)
        scheduleSyncRetry()
      } else {
        console.error('[sync] PUT /data failed:', res.status)
        setSyncPending(true)
        scheduleSyncRetry()
      }
    } catch (e) {
      console.error('[sync] error:', e && e.message, e)
      setSyncPending(true)
      scheduleSyncRetry()
    } finally {
      _syncInFlight = false
      updateStatus()
    }
  }

  function scheduleSyncRetry() {
    if (_syncRetryTimer) clearTimeout(_syncRetryTimer)
    _syncRetryTimer = setTimeout(() => { flushSync() }, 30000)
    updateStatus()
  }

  // 由 saveState() 调用：防抖 2s 后推送全量状态
  function scheduleSync() {
    if (!ctx.isOnline() || !getToken()) return
    setSyncPending(true)
    updateStatus()
    if (_syncTimer) clearTimeout(_syncTimer)
    _syncTimer = setTimeout(() => { flushSync() }, 2000)
  }

  // 登录/恢复后回放未同步数据
  function resumePendingSync() {
    if (getSyncPending() && ctx.isOnline() && getToken()) flushSync()
  }

  function setRev(rev) { if (typeof rev === 'number' && rev > 0) _syncRev = rev }

  return { scheduleSync, flushSync, resumePendingSync, updateStatus, setRev, getRev: () => _syncRev }
}
