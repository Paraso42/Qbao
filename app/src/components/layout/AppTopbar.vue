<!-- 顶栏（自 legacy topbar 迁移，DeepSeek 风格） -->
<template>
  <header id="topbar">
    <button class="tb-icon-btn" aria-label="菜单" @click="ui.toggleSidebar"><Icon name="menu" :size="20" /></button>
    <span class="tb-brand">Qbao</span>
    <NoticeBar />
    <div class="tb-spacer"></div>

    <span class="tb-pill" :class="syncClass" :title="sync.label">
      <span class="tb-pill-dot"></span>{{ syncShort }}
    </span>

    <button class="tb-item" @click="onChatClick">
      <Icon name="chat" :size="15" /> 好友
      <span v-if="chatBadge > 0" class="tb-badge">{{ chatBadge > 99 ? '99+' : chatBadge }}</span>
    </button>
    <button v-if="!user.isOnline" class="tb-item" @click="ui.openAuth"><Icon name="user" :size="15" /> 登录/注册</button>
    <button v-else class="tb-item" @click="ui.openUserCenter"><span class="tb-avatar">{{ user.shortName }}</span></button>
    <button class="tb-item" @click="ui.openSettings"><Icon name="settings" :size="15" /> 设置</button>
    <button v-if="aiRunning > 0" class="tb-ai" title="AI 任务状态" @click="ai.openQueueDialog">
      <Icon name="sparkle" :size="14" /> {{ aiRunning }}
    </button>
  </header>
</template>

<script setup>
import { computed } from 'vue'
import { useUiStore } from '../../stores/ui'
import { useUserStore } from '../../stores/user'
import { useSyncStore } from '../../stores/sync'
import { useDataStore } from '../../stores/data'
import { useAiStore } from '../../stores/ai'
import { useChatStore } from '../../stores/chat'
import Icon from '../ui/Icon.vue'
import NoticeBar from '../features/notices/NoticeBar.vue'

const ui = useUiStore()
const user = useUserStore()
const sync = useSyncStore()
const data = useDataStore()
const ai = useAiStore()
const chat = useChatStore()

const aiRunning = computed(() => {
  const queue = data.state.aiTaskQueue || []
  return queue.filter((t) => t.status === 'pending' || t.status === 'running').length
})
const chatBadge = computed(() => (chat.totalUnread || 0) + (chat.pendingRequests || 0))
function onChatClick() {
  if (!user.isOnline) { ui.openAuth(); return }
  chat.openChatModal()
}
const syncShort = computed(() => {
  if (!sync.online) return '离线'
  if (sync.syncing) return '同步中'
  return '已同步'
})
const syncClass = computed(() => ({ online: sync.online, syncing: sync.syncing }))
</script>

<style scoped>
#topbar {
  height: var(--topbar-height);
  background: var(--surface-card);
  border-bottom: 1px solid var(--border-light);
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: 0 var(--space-lg);
  flex-shrink: 0;
  font-size: var(--topbar-font-size, 14px);
}
.tb-icon-btn {
  display: none;
  width: 40px; height: 40px;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
}
.tb-icon-btn:hover { background: var(--surface-hover); }
.tb-brand {
  font-size: var(--fs-lg);
  font-weight: 700;
  letter-spacing: -0.3px;
  background: var(--gradient-primary);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.tb-spacer { flex: 1; }
.tb-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 12px;
  border-radius: var(--radius-full);
  font-size: var(--fs-xs);
  color: var(--text-muted);
  background: var(--surface-hover);
  cursor: default;
}
.tb-pill-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--status-muted); }
.tb-pill.online .tb-pill-dot { background: var(--status-ok); }
.tb-pill.syncing .tb-pill-dot { background: var(--status-run); animation: pulse 1.2s infinite; }
@keyframes pulse { 50% { opacity: 0.4; } }
.tb-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  transition: background var(--transition-fast), color var(--transition-fast);
  white-space: nowrap;
}
.tb-item:hover { background: var(--surface-hover); color: var(--text-primary); }
.tb-avatar {
  width: 26px; height: 26px;
  border-radius: 50%;
  background: var(--gradient-primary);
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: var(--fs-sm); font-weight: 600;
}
.tb-badge {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: var(--radius-full);
  background: var(--color-danger);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  line-height: 18px;
  text-align: center;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.tb-ai {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: var(--radius-full);
  background: var(--color-primary-light);
  color: var(--color-primary);
  font-size: var(--fs-sm);
  font-weight: 500;
}
.tb-ai:hover { background: var(--color-primary); color: #fff; }
@media (max-width: 768px) {
  .tb-icon-btn { display: inline-flex; align-items: center; justify-content: center; }
  .tb-pill { display: none; }
  .tb-item { padding: 6px 10px; }
}
</style>
