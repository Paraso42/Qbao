// ============================================================
// notices.js — 公告轮播 store（自 legacy notices.js 迁移）
// 语义保留：duration 毫秒/条、淡入切换、单条不轮播、hover 暂停。
// ============================================================
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useDataStore } from './data'
import { getNotices } from '../services/noticesApi'

const TYPE_MAP = {
  tip: { icon: 'info', color: '#4facfe' },
  notice: { icon: 'bell', color: '#f5a623' },
  warning: { icon: 'warning', color: '#e94560' },
  chat: { icon: 'star', color: '#2ed573' }
}

export const useNoticesStore = defineStore('notices', () => {
  const data = useDataStore()

  const notices = ref([])
  const currentIdx = ref(0)
  const transitioning = ref(false)

  let timer = null

  const showBar = computed(() => data.state.settings.showNoticeBar !== false)
  const visible = computed(() => notices.value.length > 0 && showBar.value)
  const current = computed(() => notices.value[currentIdx.value] || null)
  const currentMeta = computed(() => TYPE_MAP[(current.value && current.value.type)] || TYPE_MAP.notice)

  async function load() {
    notices.value = await getNotices()
    currentIdx.value = 0
    transitioning.value = false
    if (notices.value.length > 1) startRotation()
    else stopRotation()
  }

  function startRotation() {
    stopRotation()
    if (notices.value.length === 0) return
    const n = notices.value[currentIdx.value]
    const ms = n ? (n.duration || 4000) : 4000
    timer = setTimeout(rotate, ms)
  }

  function stopRotation() {
    if (timer) { clearTimeout(timer); timer = null }
  }

  function pauseRotation() { stopRotation() }

  function resumeRotation() {
    if (notices.value.length > 1 && !transitioning.value) startRotation()
  }

  function rotate() {
    if (notices.value.length <= 1) { transitioning.value = false; return }
    transitioning.value = true // 淡出
    setTimeout(() => {
      currentIdx.value = (currentIdx.value + 1) % notices.value.length
      transitioning.value = false // 淡入
      startRotation()
    }, 300)
  }

  function reset() {
    stopRotation()
    currentIdx.value = 0
    transitioning.value = false
    if (notices.value.length > 1) startRotation()
  }

  return {
    notices, currentIdx, transitioning, visible, showBar, current, currentMeta,
    load, startRotation, stopRotation, pauseRotation, resumeRotation, rotate, reset
  }
})