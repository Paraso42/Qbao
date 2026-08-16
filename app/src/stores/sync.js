// 同步状态（乐观锁引擎在 services/sync.js，阶段 2 迁移）
import { defineStore } from 'pinia'

export const useSyncStore = defineStore('sync', {
  state: () => ({
    online: false,
    syncing: false,
    lastSyncAt: null
  }),
  getters: {
    label(state) {
      if (!state.online) return '离线'
      if (state.syncing) return '同步中…'
      if (state.lastSyncAt) {
        const t = new Date(state.lastSyncAt)
        return '已同步 ' + t.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      }
      return '未同步'
    }
  },
  actions: {
    setOnline(v) { this.online = v },
    setSyncing(v) { this.syncing = v },
    markSynced() { this.lastSyncAt = Date.now() }
  }
})
