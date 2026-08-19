// ============================================================
// points.js — 积分 store（v3.29）
// 维护余额（与 user store 同步）、积分规则（24h 缓存）、台账分页、
// 成就领取（接口幂等）、AI 配额、学期清零倒计时。
// ============================================================
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useUserStore } from './user'
import { useUiStore } from './ui'
import * as pointsApi from '../services/pointsApi'
import * as filesApi from '../services/filesApi'

const RULES_TTL = 24 * 3600 * 1000

export const usePointsStore = defineStore('points', () => {
  const user = useUserStore()
  const ui = useUiStore()

  // —— 余额（权威在 user.user.storagePoints；本 store 提供同步入口） ——
  const balance = computed(() => (user.user && user.user.storagePoints) || 0)

  // —— 规则 ——
  const rules = ref(null)          // { earn[], spend[], expiry, nextExpiry, reasonLabels }
  const rulesLoadedAt = ref(0)

  // —— 台账 ——
  const ledger = ref([])
  const ledgerTotal = ref(0)
  const ledgerPage = ref(1)
  const ledgerLimit = ref(20)
  const ledgerLoading = ref(false)

  // —— 配额 ——
  const quota = ref(null)

  // 学期清零：距下一个清零日（N≤7 天且余额>0 时前端警示）
  const daysToExpiry = computed(() => {
    const ne = rules.value && rules.value.nextExpiry
    if (!ne || typeof ne.daysLeft !== 'number') return null
    return ne.daysLeft
  })
  const expiryWarnVisible = computed(() => {
    if (!(daysToExpiry.value !== null && daysToExpiry.value <= 7)) return false
    return balance.value > 0
  })

  function applyBalance(n) {
    if (typeof n === 'number' && user.user) {
      const next = { ...user.user, storagePoints: n }
      user.user = next
      try { localStorage.setItem('qbao_user', JSON.stringify(next)) } catch (e) {}
    }
  }

  async function refreshBalance() {
    try {
      const r = await pointsApi.getBalance()
      if (r && typeof r.balance === 'number') applyBalance(r.balance)
    } catch (e) { /* 静默 */ }
  }

  async function loadRules(force = false) {
    if (!force && rules.value && Date.now() - rulesLoadedAt.value < RULES_TTL) return rules.value
    try {
      const r = await pointsApi.getRules()
      if (r && r.earn) {
        rules.value = r
        rulesLoadedAt.value = Date.now()
      }
      return rules.value
    } catch (e) {
      return rules.value
    }
  }

  async function loadLedger(page = 1) {
    ledgerLoading.value = true
    try {
      const r = await pointsApi.getLedger({ page, limit: ledgerLimit.value })
      ledger.value = (r && r.items) || []
      ledgerTotal.value = (r && r.total) || 0
      ledgerPage.value = page
    } catch (e) {
      ui.toast('加载积分明细失败: ' + e.message, 'err')
    } finally {
      ledgerLoading.value = false
    }
  }

  async function loadQuota() {
    try {
      quota.value = await pointsApi.getQuota()
    } catch (e) { /* 静默：配额仅是提示 */ }
    return quota.value
  }

  // 成就领取（服务端幂等；重复领取静默）
  async function claimAchievement(refId) {
    try {
      const r = await pointsApi.claimAchievement(refId)
      if (r && r.awarded && typeof r.balance === 'number') {
        applyBalance(r.balance)
        ui.toast('成就奖励 +' + r.points + ' 积分', 'ok')
      }
      return r
    } catch (e) {
      return null
    }
  }

  // 文件池续期：确认后扣分并同步余额
  async function extendFile(fileId) {
    try {
      const r = await filesApi.extendFile(fileId)
      if (r && typeof r.balance === 'number') applyBalance(r.balance)
      return r
    } catch (e) {
      ui.toast('续期失败: ' + e.message, 'err')
      return null
    }
  }

  return {
    balance, rules, daysToExpiry, expiryWarnVisible,
    ledger, ledgerTotal, ledgerPage, ledgerLimit, ledgerLoading,
    quota,
    applyBalance, refreshBalance, loadRules, loadLedger, loadQuota,
    claimAchievement, extendFile,
  }
})
