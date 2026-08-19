// ============================================================
// boot.js — 应用初始化编排：同步引擎接线、云端恢复、暗色模式
// ============================================================
import { watch } from 'vue'
import { useDataStore } from '../stores/data'
import { useUserStore } from '../stores/user'
import { useSyncStore } from '../stores/sync'
import { useUiStore } from '../stores/ui'
import { createSyncEngine } from '../services/sync'
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

  watch(() => user.isOnline, (online) => {
    syncStore.setOnline(online)
    if (online) {
      restoreFromCloud().then(() => engine.resumePendingSync())
    }
  })

  if (user.isOnline) {
    restoreFromCloud().then(() => engine.resumePendingSync())
  }

  // 跨端快速同步：定期轮询云端版本 + 焦点/可见性即时拉取
  engine.startPolling(20000)
  engine.bindVisibilityLifecycle()

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
