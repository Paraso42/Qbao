<!--
  FeedbackPanel.vue — 用户端「我的反馈」列表 + 新建（对应 legacy feedback.js：
  fbRenderUserBubbleCard / fbRenderUserIssueList / fbSubmitIssue / fbShowRenameDialog / fbDoRename）
-->
<template>
  <div class="fb-card-content">
    <div class="fb-card-header"><span>我的反馈</span></div>

    <div class="fb-issue-list">
      <div v-if="store.issues.length === 0" class="fb-issue-list-empty">
        暂无反馈记录<br>在下方输入框中提交
      </div>
      <template v-else>
        <!-- 已完成（closed）— 最上方 -->
        <div v-if="groups.closed.length > 0" class="fb-collapse-section">
          <div class="fb-collapse-header" @click="showClosed = !showClosed">
            <span class="fb-collapse-arrow">{{ showClosed ? '▼' : '▶' }}</span>
            <span>已完成 ({{ groups.closed.length }})</span>
          </div>
          <div v-if="showClosed" class="fb-collapse-body">
            <IssueListItem v-for="issue in groups.closed" :key="issue.id" :issue="issue" @open="open(issue)" @rename="onRename(issue)" />
          </div>
        </div>
        <!-- 处理完毕（resolved）— 中间 -->
        <div v-if="groups.resolved.length > 0" class="fb-collapse-section">
          <div class="fb-collapse-header" @click="showResolved = !showResolved">
            <span class="fb-collapse-arrow">{{ showResolved ? '▼' : '▶' }}</span>
            <span>处理完毕 · 待验证 ({{ groups.resolved.length }})</span>
          </div>
          <div v-if="showResolved" class="fb-collapse-body">
            <IssueListItem v-for="issue in groups.resolved" :key="issue.id" :issue="issue" @open="open(issue)" @rename="onRename(issue)" />
          </div>
        </div>
        <!-- 活跃（unread/read）— 最下方 -->
        <IssueListItem v-for="issue in groups.active" :key="issue.id" :issue="issue" @open="open(issue)" @rename="onRename(issue)" />
      </template>
    </div>

    <div class="fb-input-area">
      <textarea v-model="draft" class="textarea fb-input-textarea" placeholder="请输入反馈内容..."></textarea>
      <button class="btn btn-primary btn-small fb-input-submit" :disabled="!draft.trim()" @click="onSubmit">发送</button>
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

const draft = ref('')
const showClosed = ref(false)
const showResolved = ref(false)

const groups = computed(() => store.userGroups)

function open(issue) { store.openDetail(issue.id) }

async function onRename(issue) {
  const title = await ui.openPrompt('修改标题', issue.title)
  if (title == null) return
  if (!title) { ui.toast('标题不能为空', 'err'); return }
  if (title.length > 500) { ui.toast('标题不能超过500字', 'err'); return }
  try {
    await store.rename(issue.id, title)
    ui.toast('标题已更新', 'ok')
  } catch (e) { ui.toast(e.message, 'err') }
}

async function onSubmit() {
  if (!draft.value.trim()) return
  try {
    await store.submitIssue(draft.value)
    draft.value = ''
    ui.toast('反馈已提交', 'ok')
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
  line-height: var(--lh-relaxed);
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
.fb-input-area {
  flex-shrink: 0;
  padding: 10px 14px;
  border-top: 1px solid var(--border-light);
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}
.fb-input-textarea { min-height: 56px; }
.fb-input-submit { align-self: flex-end; }
</style>
