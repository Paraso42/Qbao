<!--
  IssueAdminPanel.vue — 管理员「用户反馈」列表（对应 legacy feedback.js：
  fbRenderAdminBubbleCard / fbRenderAdminBubbleList / fbAdminDeleteIssue）
-->
<template>
  <div class="fb-card-content">
    <div class="fb-card-header"><span>用户反馈</span></div>

    <div class="fb-issue-list">
      <div v-if="store.adminIssues.length === 0" class="fb-issue-list-empty">暂无用户反馈</div>
      <template v-else>
        <!-- 已完成（closed）— 最上方 -->
        <div v-if="groups.closed.length > 0" class="fb-collapse-section">
          <div class="fb-collapse-header" @click="showClosed = !showClosed">
            <span class="fb-collapse-arrow">{{ showClosed ? '▼' : '▶' }}</span>
            <span>已完成 ({{ groups.closed.length }})</span>
          </div>
          <div v-if="showClosed" class="fb-collapse-body">
            <IssueListItem v-for="issue in groups.closed" :key="issue.id" :issue="issue" :admin="true" @open="open(issue)" @delete="onDelete(issue)" />
          </div>
        </div>
        <!-- 处理完毕（resolved）— 中间 -->
        <div v-if="groups.resolved.length > 0" class="fb-collapse-section">
          <div class="fb-collapse-header" @click="showResolved = !showResolved">
            <span class="fb-collapse-arrow">{{ showResolved ? '▼' : '▶' }}</span>
            <span>处理完毕 · 待用户验证 ({{ groups.resolved.length }})</span>
          </div>
          <div v-if="showResolved" class="fb-collapse-body">
            <IssueListItem v-for="issue in groups.resolved" :key="issue.id" :issue="issue" :admin="true" @open="open(issue)" @delete="onDelete(issue)" />
          </div>
        </div>
        <!-- 活跃（unread/read）— 最下方，离气泡最近 -->
        <IssueListItem v-for="issue in groups.active" :key="issue.id" :issue="issue" :admin="true" @open="open(issue)" @delete="onDelete(issue)" />
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useIssuesStore } from '../../../stores/issues'
import { useUiStore } from '../../../stores/ui'
import IssueListItem from './IssueListItem.vue'

const store = useIssuesStore()
const ui = useUiStore()

const showClosed = ref(false)
const showResolved = ref(false)

const groups = computed(() => store.adminGroups)

function open(issue) { store.openDetail(issue.id) }

async function onDelete(issue) {
  const ok = await ui.openConfirm('删除反馈', '确定删除此反馈？删除后用户端将同步移除，且无法恢复。', '删除', { danger: true })
  if (!ok) return
  try {
    await store.remove(issue.id)
    ui.toast('反馈已删除', 'ok')
  } catch (e) { ui.toast(e.message, 'err') }
}
</script>

<style scoped>
.fb-card-content {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.fb-card-header {
  flex-shrink: 0;
  padding: 12px 14px 8px;
  font-size: var(--fs-base);
  font-weight: 600;
  color: var(--text-primary);
  border-bottom: 1px solid var(--border-light);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.fb-issue-list { flex: 1; overflow-y: auto; min-height: 0; }
.fb-issue-list-empty {
  padding: var(--space-3xl) var(--space-lg);
  text-align: center;
  font-size: var(--fs-sm);
  color: var(--text-muted);
}
.fb-collapse-section { border-top: 1px solid var(--border-light); }
.fb-collapse-header {
  padding: 10px 14px;
  font-size: var(--fs-xs);
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  user-select: none;
  transition: background var(--transition-fast);
}
.fb-collapse-header:hover { background: var(--surface-hover); }
.fb-collapse-arrow { font-size: 10px; width: 14px; text-align: center; }
.fb-collapse-body { border-top: 1px solid var(--border-light); }
</style>