// ============================================================
// boot.js — 应用初始化编排：同步引擎接线、云端恢复、暗色模式
// ============================================================
import { watch } from 'vue'
import { useDataStore } from '../stores/data'
import { useUserStore } from '../stores/user'
import { useSyncStore } from '../stores/sync'
import { useUiStore } from '../stores/ui'
import { createSyncEngine } from '../services/sync'
import { fetchWithAuth, getToken } from '../services/api'
import { migrateState, CLOUD_STORAGE_PREFIX } from '../services/persistence'
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

  // 答题引擎：页面生命周期同步（beforeunload/visibilitychange）
  const quiz = useQuizStore(pinia)
  quiz.bindLifecycle()

  applyDarkMode()
  applyFontSizes(data.state.settings)
  watch(() => data.state.settings.darkMode, applyDarkMode)
  watch(() => data.state.settings, () => applyFontSizes(data.state.settings), { deep: true })
}

// 登录/恢复后：新设备（无本地缓存）从云端恢复；本地优先语义同 legacy DataStoreInit。
async function restoreFromCloud() {
  const data = useDataStore()
  const user = useUserStore()
  if (!user.isOnline || !getToken()) return
  const cloudKey = CLOUD_STORAGE_PREFIX + user.userId
  try {
    const res = await fetchWithAuth('/data')
    if (!res) return
    const cloud = await res.json()
    if (cloud && typeof cloud.rev === 'number') engine.setRev(cloud.rev)
    if (cloud && cloud.state_json && cloud.synced_at) {
      const localSaved = localStorage.getItem(cloudKey)
      if (!localSaved) {
        data.replaceState(migrateState(cloud.state_json))
        localStorage.setItem(cloudKey, JSON.stringify(data.state))
      }
    }
  } catch (e) {
    console.warn('[boot] cloud load err', e)
  }
}

function applyDarkMode() {
  const data = useDataStore()
  const dark = !!(data.state.settings && data.state.settings.darkMode)
  document.documentElement.classList.toggle('dark-mode', dark)
}
