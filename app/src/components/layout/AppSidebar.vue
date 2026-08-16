<template>
  <aside id="sidebar" :class="{ 'mobile-open': ui.sidebarOpen }">
    <div id="sidebar-header">
      <h2>科目</h2>
      <button class="btn btn-primary btn-small" @click="ui.openCreateSubject">＋ 科目</button>
    </div>
    <div id="sidebar-body">
      <div class="empty-state" v-if="subjects.list.length === 0">
        <div class="es-title">还没有科目</div>
        <div class="es-hint">创建科目并添加章节，开始你的学习之旅</div>
      </div>
      <div v-else class="subject-list">
        <div v-for="s in subjects.list" :key="s.id" class="subject-item" @click="subjects.select(s.id)">
          {{ s.name }}
        </div>
      </div>
    </div>
    <div id="sidebar-footer">
      <div class="sync-status" :class="syncClass">
        <span class="sync-dot"></span>{{ sync.label }}
      </div>
    </div>
  </aside>
  <div class="sidebar-overlay" :class="{ active: ui.sidebarOpen }" @click="ui.toggleSidebar"></div>
</template>

<script setup>
import { computed } from 'vue'
import { useUiStore } from '../../stores/ui'
import { useSubjectStore } from '../../stores/subjects'
import { useSyncStore } from '../../stores/sync'
const ui = useUiStore()
const subjects = useSubjectStore()
const sync = useSyncStore()
const syncClass = computed(() => ({ online: sync.online, syncing: sync.syncing }))
</script>

<style scoped>
#sidebar {
  width: var(--sidebar-width);
  background: var(--surface-card);
  border-right: 1px solid var(--border-light);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  overflow: hidden;
}
#sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-lg);
  border-bottom: 1px solid var(--border-light);
}
#sidebar-header h2 { font-size: var(--fs-md); }
#sidebar-body { flex: 1; overflow-y: auto; padding: var(--space-sm); }
.subject-item {
  padding: 10px 12px;
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: var(--fs-base);
  color: var(--text-secondary);
  transition: background var(--transition-fast), color var(--transition-fast);
}
.subject-item:hover { background: var(--surface-hover); color: var(--text-primary); }
.subject-item.active { background: var(--color-primary-light); color: var(--color-primary); font-weight: 500; }
#sidebar-footer { border-top: 1px solid var(--border-light); padding: var(--space-md) var(--space-lg); }
.sync-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--fs-sm);
  color: var(--text-muted);
}
.sync-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--status-muted); }
.sync-status.online .sync-dot { background: var(--status-ok); }
.sync-status.syncing .sync-dot { background: var(--status-run); animation: pulse 1.2s infinite; }
@keyframes pulse { 50% { opacity: 0.4; } }

.sidebar-overlay { display: none; }
@media (max-width: 900px) {
  #sidebar {
    position: fixed;
    left: 0;
    top: var(--topbar-height);
    height: calc(100vh - var(--topbar-height));
    z-index: 9500;
    transform: translateX(-100%);
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }
  #sidebar.mobile-open { transform: translateX(0); box-shadow: var(--shadow-lg); }
  .sidebar-overlay {
    display: block;
    position: fixed;
    inset: var(--topbar-height) 0 0 0;
    background: rgba(23, 24, 28, 0.45);
    z-index: 9400;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.3s ease;
  }
  .sidebar-overlay.active { opacity: 1; pointer-events: auto; }
}
</style>
