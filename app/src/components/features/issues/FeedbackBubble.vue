<!--
  FeedbackBubble.vue — 右下悬浮客服入口 + 未读徽章（对应 legacy feedback.js：
  fbToggleBubble / fbRenderBubbleCard / fbUpdateBadge + index.html 的 edge-bubble 结构）
-->
<template>
  <Teleport to="body">
    <div class="edge-bubble-trigger" ref="triggerRef">
      <Transition name="bubble-card">
        <div v-if="store.panelOpen" class="edge-bubble-card">
          <FeedbackPanel v-if="user.isOnline && !store.isAdmin" />
          <IssueAdminPanel v-else-if="user.isOnline && store.isAdmin" />
          <div v-else class="fb-card-content">
            <div class="fb-issue-list-empty">请先登录</div>
          </div>
        </div>
      </Transition>

      <button class="edge-bubble" :class="{ 'edge-bubble--open': store.panelOpen }" aria-label="客服反馈" @click="toggle">
        <Icon name="chat" :size="22" />
        <span v-if="store.unreadCount > 0" class="fb-badge">{{ store.unreadCount > 99 ? '99+' : store.unreadCount }}</span>
      </button>
    </div>
  </Teleport>

  <IssueDetailModal />
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import Icon from '../../ui/Icon.vue'
import { useIssuesStore } from '../../../stores/issues'
import { useUserStore } from '../../../stores/user'
import FeedbackPanel from './FeedbackPanel.vue'
import IssueAdminPanel from './IssueAdminPanel.vue'
import IssueDetailModal from './IssueDetailModal.vue'

const store = useIssuesStore()
const user = useUserStore()
const triggerRef = ref(null)

function toggle() {
  if (store.panelOpen) store.closePanel()
  else store.openPanel()
}

// 点击面板/气泡区域外时关闭（同 legacy 全局点击监听）
function onDocumentClick(e) {
  if (!store.panelOpen) return
  if (triggerRef.value && triggerRef.value.contains(e.target)) return
  store.closePanel()
}

// 登录后播种未读徽章；登出时清理
watch(() => user.isOnline, (online) => {
  if (online) store.refreshUnread()
  else { store.closePanel(); store.unreadCount = 0 }
}, { immediate: true })

onMounted(() => document.addEventListener('click', onDocumentClick))
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  store.stopPolling()
})
</script>

<style scoped>
.edge-bubble-trigger {
  position: fixed;
  right: 20px;
  bottom: 24px;
  z-index: 8000;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--space-md);
}
.edge-bubble {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--gradient-primary);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  position: relative;
  border: none;
  box-shadow: var(--shadow-lg);
  transition: transform var(--transition-fast), box-shadow var(--transition-fast);
}
.edge-bubble:hover { transform: scale(1.06); }
.edge-bubble:active { transform: scale(0.96); }
.edge-bubble:focus-visible { box-shadow: var(--shadow-glow); }
.fb-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: var(--radius-full);
  background: var(--color-danger);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  line-height: 18px;
  text-align: center;
}
.edge-bubble-card {
  width: 340px;
  max-height: 480px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--radius-lg);
  background: var(--surface-card);
  border: 1px solid var(--border-light);
  box-shadow: var(--shadow-lg);
}
.fb-card-content { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.fb-issue-list-empty {
  padding: var(--space-3xl) var(--space-lg);
  text-align: center;
  font-size: var(--fs-sm);
  color: var(--text-muted);
}
.bubble-card-enter-active, .bubble-card-leave-active { transition: opacity 0.25s ease, transform 0.25s ease; }
.bubble-card-enter-from, .bubble-card-leave-to { opacity: 0; transform: translateY(12px); }
@media (max-width: 768px) {
  .edge-bubble-card { width: min(340px, calc(100vw - 40px)); }
}
</style>
