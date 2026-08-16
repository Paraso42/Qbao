<!--
  NoticeBar.vue — 顶栏公告轮播（对应 legacy notices.js：
  loadNotices / renderNoticeBar / applyNoticeScrollClass / start-rotate / pause-resume / clickNotice）
  挂载到顶栏 flex 容器内时通过 flex:1 占据剩余宽度。
-->
<template>
  <div v-show="store.visible" class="notice-bar-wrap" ref="wrapRef"
       @mouseenter="store.pauseRotation()" @mouseleave="store.resumeRotation()" @click="onClick">
    <div class="notice-bar" :class="{ scroll: scrolling, fading: store.transitioning }" :style="scrollStyle" ref="barRef">
      <span class="notice-icon" :style="{ color: store.currentMeta.color }">{{ store.currentMeta.icon }}</span>
      <span class="notice-text">{{ store.current ? store.current.content : '' }}</span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useNoticesStore } from '../../../stores/notices'

const store = useNoticesStore()
const wrapRef = ref(null)
const barRef = ref(null)
const scrolling = ref(false)
const scrollDist = ref('')
const scrollDuration = ref('')

const scrollStyle = computed(() => {
  const style = {}
  if (scrollDist.value) style['--scroll-dist'] = scrollDist.value
  if (scrollDuration.value) style['--scroll-duration'] = scrollDuration.value
  return style
})

// 超宽时应用 marquee 滚动（同 applyNoticeScrollClass）
function applyScrollClass() {
  nextTick(() => {
    const bar = barRef.value
    const wrap = wrapRef.value
    if (!bar || !wrap) return
    scrolling.value = false
    scrollDist.value = ''
    scrollDuration.value = ''
    if (bar.scrollWidth > wrap.clientWidth) {
      const dist = bar.scrollWidth - wrap.clientWidth + 40
      scrollDist.value = '-' + dist + 'px'
      const n = store.current
      const ms = n ? (n.duration || 4000) : 4000
      scrollDuration.value = Math.max(3, ms / 1000) + 's'
      scrolling.value = true
    }
  })
}

watch(() => store.notices, () => applyScrollClass())
watch(() => store.currentIdx, () => applyScrollClass())

function onClick() {
  const n = store.current
  if (n && n.link) window.open(n.link, '_blank')
}

onMounted(() => { store.load() })
onBeforeUnmount(() => { store.stopRotation() })
</script>

<style scoped>
.notice-bar-wrap {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  margin: 0 auto;
  position: relative;
}
.notice-bar {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: var(--fs-xs);
  color: var(--text-muted);
  white-space: nowrap;
  cursor: pointer;
  transition: opacity 0.3s ease;
}
.notice-bar.fading { opacity: 0; }
.notice-icon { flex-shrink: 0; }
.notice-text { overflow: hidden; text-overflow: ellipsis; }
.notice-bar.scroll { animation: notice-scroll var(--scroll-duration, 14s) linear infinite; }
@keyframes notice-scroll {
  0%, 15% { transform: translateX(0); }
  85%, 100% { transform: translateX(var(--scroll-dist, -100px)); }
}
</style>
