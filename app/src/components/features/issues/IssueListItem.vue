<!--
  IssueListItem.vue — 工单列表行（对应 legacy feedback.js 的 fbIssueItemHTML）
-->
<template>
  <div class="fb-issue-item" :class="{ 'fb-issue-item-new': hasNew }" @click="$emit('open')">
    <span class="fb-issue-item-icon" :style="{ background: statusColor(issue.status) }"></span>
    <span class="fb-issue-item-title">{{ issue.title }}</span>
    <span v-if="hasNew" class="fb-issue-new-dot"></span>
    <span class="fb-issue-item-time">{{ formatIssueTime(issue.updated_at || issue.created_at) }}</span>
    <span class="fb-issue-item-actions">
      <button v-if="admin && issue.status !== 'closed'" class="fb-action-btn fb-btn-delete" title="删除" @click.stop="$emit('delete')">
        <Icon name="trash" :size="14" />
      </button>
      <button v-if="!admin && (issue.status === 'unread' || issue.status === 'read')" class="fb-action-btn" title="重命名" @click.stop="$emit('rename')">
        <Icon name="edit" :size="14" />
      </button>
    </span>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import Icon from '../../ui/Icon.vue'
import { statusColor, formatIssueTime } from './helpers'

const props = defineProps({
  issue: { type: Object, required: true },
  admin: { type: Boolean, default: false }
})
defineEmits(['open', 'rename', 'delete'])

const hasNew = computed(() => (props.admin ? props.issue.has_new_for_admin : props.issue.has_new_for_user))
</script>

<style scoped>
.fb-issue-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  cursor: pointer;
  border-bottom: 1px solid var(--border-light);
  transition: background var(--transition-fast);
}
.fb-issue-item:hover { background: var(--surface-hover); }
.fb-issue-item:last-child { border-bottom: none; }
.fb-issue-item-new { background: var(--color-warning-light); }
.fb-issue-item-icon {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.fb-issue-item-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-sm);
  color: var(--text-primary);
}
.fb-issue-item-time { flex-shrink: 0; font-size: 11px; color: var(--text-muted); }
.fb-issue-new-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-danger);
  flex-shrink: 0;
}
.fb-issue-item-actions {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  flex-shrink: 0;
  display: flex;
  gap: 4px;
  opacity: 0;
  pointer-events: none;
  background: inherit;
  padding-left: 10px;
  transition: opacity var(--transition-fast);
}
.fb-issue-item:hover .fb-issue-item-actions { opacity: 1; pointer-events: auto; }
.fb-action-btn {
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-light);
  background: var(--surface-card);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: border-color var(--transition-fast), color var(--transition-fast), background var(--transition-fast);
}
.fb-action-btn:hover { border-color: var(--color-primary); color: var(--color-primary); }
.fb-action-btn.fb-btn-delete:hover { border-color: var(--color-danger); color: var(--color-danger); background: var(--color-danger-light); }
</style>
