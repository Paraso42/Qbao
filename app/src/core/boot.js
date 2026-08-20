// ============================================================
// boot.js — 应用初始化编排：同步引擎接线、云端恢复、暗色模式
// ============================================================
import { watch } from 'vue'
import { useDataStore } from '../stores/data'
import { useUserStore } from '../stores/user'
import { useSyncStore } from '../stores/sync'
import { useUiStore } from '../stores/ui'
import { createSyncEngine } from '../services/sync'
import { setPersistWarningHook, hydrateState } from '../services/persistence'
import { getToken } from '../services/api'
import { useQuizStore } from '../stores/quiz'
import { applyFontSizes } from './fontSizes'

let engine = null

export function getSyncEngine() { return engine }

export function initApp(pinia) {
  const data = useDataStore(pinia)
  const user = useUserStore(pinia)
  const syncStore = useSyncStore(pinia)
  const ui = useUiStore(pinia)

  // T12: 持久化失败/接近上限 → 用户可见提示（不再静默丢数据）
  setPersistWarningHook((msg, fatal) => ui.toast(msg, fatal ? 'err' : 'info'))

  engine = createSyncEngine({
    getState: () => data.state,
    replaceState: (merged) => data.replaceState(merged),
    isOnline: () => user.isOnline,
    onStatus: (s) => {
      syncStore.setSyncing(s.syncing)
      if (typeof s.lastSyncAt === 'number') syncStore.lastSyncAt = s.lastSyncAt
    },
    notify: (msg) => ui.toast(msg, 'info')
  })
  data.setSyncHook(() => engine.scheduleSync())

  syncStore.setOnline(user.isOnline)

  // v3.30：启动门闩 — 本地 IDB 回填 + 云端恢复完成前禁止同步推送
  // （防止骨架态（无题目）被 flushSync 推上服务器覆盖云端数据）
  hydrateState(data.state).catch(() => {}).then(() => {
    const bootRestore = user.isOnline ? restoreFromCloud() : Promise.resolve()
    bootRestore.finally(() => {
      engine.setSyncingReady(true)
      if (user.isOnline) engine.resumePendingSync()
    })
  })

  watch(() => user.isOnline, (online) => {
    syncStore.setOnline(online)
    if (online) {
      engine.setSyncingReady(true)
      restoreFromCloud().then(() => engine.resumePendingSync())
    }
  })

  // 跨端快速同步：定期轮询云端版本 + 焦点/可见性即时拉取
  engine.startPolling(20000)
  engine.bindVisibilityLifecycle()
  // T10: 页面关闭前 keepalive 尽力推送未同步数据
  engine.bindUnloadKeepalive()

  // 答题引擎：页面生命周期同步（beforeunload/visibilitychange）
  const quiz = useQuizStore(pinia)
  quiz.bindLifecycle()

  applyDarkMode()
  applyFontSizes(data.state.settings)
  watch(() => data.state.settings.darkMode, applyDarkMode)
  watch(() => data.state.settings, () => applyFontSizes(data.state.settings), { deep: true })
}

// 启动/恢复后：总是拉取云端并合并（本地优先并集，云端独有实体并入）。
// 修复：旧逻辑仅在本地无缓存时恢复，导致"桌面端生成 → 网页端本地缓存旧 → 永不显示"。
async function restoreFromCloud() {
  const user = useUserStore()
  if (!user.isOnline || !getToken()) return
  await engine.pullAndMerge()
}

function applyDarkMode() {
  const data = useDataStore()
  const dark = !!(data.state.settings && data.state.settings.darkMode)
  document.documentElement.classList.toggle('dark-mode', dark)
}