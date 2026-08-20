<!-- AI 出题任务队列（本地 + 服务端，自 legacy ai-workflow 任务弹窗迁移 + v3.27 服务端任务补全） -->
<template>
  <Modal :open="ai.queueDialogOpen" wide @close="ai.closeQueueDialog">
    <h3 class="tq-title">AI 出题任务队列</h3>

    <h4 class="tq-section">本地任务</h4>
    <div class="tq-list">
      <EmptyState v-if="localTasks.length === 0" icon="sparkle" title="暂无本地任务" hint="在章节页上传资料后点击「AI 生成」即可创建任务" />
      <div v-for="task in localTasks" :key="task.id" class="task-item">
        <span class="task-dot" :class="'dot-' + task.status"></span>
        <div class="task-main">
          <div class="task-title">{{ task.chapterName }}</div>
          <div v-if="task.status === 'failed' && task.error" class="task-error">{{ task.error }}</div>
          <div v-else-if="task.status === 'running' && task.streamQuestionCount > 0" class="task-sub">已生成 {{ task.streamQuestionCount }} 题，可直接开始答题</div>
          <div v-else class="task-sub">{{ taskStatusText(task) }}</div>
        </div>
        <span v-if="task.status === 'completed'" class="pill pill-ok">{{ task.questionCount }} 题</span>
        <span v-else-if="task.status === 'failed'" class="pill pill-fail">失败</span>
        <span v-else-if="task.status === 'running'" class="pill pill-run">运行中</span>
        <span v-else class="pill pill-queued">等待中</span>
        <template v-if="task.status === 'pending' || task.status === 'running'">
          <button v-if="task.status === 'running' && task.streamQuestionCount >= streamThreshold" class="btn btn-text btn-small" @click="startStreamQuiz(task)">开始答题</button>
          <button class="btn btn-ghost btn-small" @click="ai.cancelTask(task.id)">取消</button>
        </template>
      </div>
    </div>

    <div class="tq-server-head">
      <h4 class="tq-section">服务端任务</h4>
      <button class="btn btn-ghost btn-small" :disabled="ai.serverTasksLoading" @click="ai.refreshServerTasks">刷新</button>
    </div>
    <div class="tq-list">
      <EmptyState v-if="serverTasks.length === 0" icon="clock" title="暂无服务端任务" hint="在 AI 配置中开启「服务端任务队列」后，出题任务将在这里后台执行" />
      <div v-for="st in serverTasks" :key="st.id" class="task-item">
        <span class="task-dot" :class="'dot-' + st.status"></span>
        <div class="task-main">
          <div class="task-title">{{ serverTaskChapterName(st) }} <span class="task-id">#{{ st.id }}</span></div>
          <div v-if="st.error" class="task-error">{{ st.error }}</div>
          <div class="task-sub">{{ serverTaskText(st) }}</div>
        </div>
        <span class="pill" :class="'pill-' + serverPillType(st.status)">{{ serverStatusText(st.status) }}</span>
        <template v-if="st.status === 'completed'">
          <span v-if="ai.isServerTaskImported(st.id)" class="pill pill-ok">已导入</span>
          <button v-else class="btn btn-primary btn-small" @click="importTask(st)">导入题目</button>
        </template>
        <template v-else-if="st.status === 'queued' || st.status === 'running'">
          <button class="btn btn-ghost btn-small" @click="ai.cancelServerTask(st.id)">取消</button>
        </template>
      </div>
    </div>

    <div class="dialog-actions">
      <button class="btn btn-danger btn-small" @click="cancelAll">停止全部</button>
      <button class="btn btn-secondary btn-small" @click="ai.closeQueueDialog">关闭</button>
    </div>
  </Modal>
</template>

<script setup>
import { computed } from 'vue'
import { useAiStore } from '../../../stores/ai'
import { useDataStore } from '../../../stores/data'
import { useUiStore } from '../../../stores/ui'
import { useQuizStore } from '../../../stores/quiz'
import Modal from '../../ui/Modal.vue'
import EmptyState from '../../ui/EmptyState.vue'

const ai = useAiStore()
const data = useDataStore()
const ui = useUiStore()
const quiz = useQuizStore()

// 服务端任务模式下：本地任务不在此列表重复显示（完全在服务端），
// 但保留取消能力（取消入口在服务端任务区）
const localTasks = computed(() => {
  const queue = data.state.aiTaskQueue || []
  return queue.filter((t) => !t.serverTaskId).slice().reverse()
})
const serverTasks = computed(() => ai.serverTasks || [])
const streamThreshold = computed(() => (data.state.aiConfig && data.state.aiConfig.streamThreshold) || 3)

function taskStatusText(task) {
  if (task.status === 'pending') return '排队等待执行'
  if (task.status === 'running') {
    if (task.serverTaskId) return '服务端后台生成中…'
    return '正在生成…'
  }
  if (task.status === 'completed') {
    const t = task.completedAt ? new Date(task.completedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''
    return '完成于 ' + t
  }
  return ''
}

function serverTaskChapterName(st) {
  const ch = data.state.chapters[st.chapterId]
  return ch ? ch.name : '章节已删除'
}
function serverTaskText(st) {
  const t = st.createdAt ? new Date(st.createdAt).toLocaleString('zh-CN') : ''
  if (st.status === 'running' || st.status === 'queued') return '创建于 ' + t
  if (st.status === 'completed') {
    const count = (st.result && Array.isArray(st.result.questions)) ? st.result.questions.length : 0
    return '生成 ' + count + ' 题 · 完成于 ' + (st.finishedAt ? new Date(st.finishedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '')
  }
  return '创建于 ' + t
}
function serverStatusText(status) {
  const map = { queued: '排队中', running: '运行中', completed: '已完成', failed: '失败', canceled: '已取消' }
  return map[status] || status
}
function serverPillType(status) {
  const map = { queued: 'queued', running: 'run', completed: 'ok', failed: 'fail', canceled: 'muted' }
  return map[status] || 'muted'
}

function startStreamQuiz(task) {
  const ch = data.state.chapters[task.chapterId]
  if (!ch || !task.streamSetRef) return
  ch.currentQuizSetIdx = ch.quizSets.indexOf(task.streamSetRef)
  data.state.currentChapterId = task.chapterId
  data.saveState()
  ai.closeQueueDialog()
  quiz.openQuiz('quiz')
}

async function importTask(st) {
  // T18: await 导入完成（原未 await，toast/状态竞态）
  await ai.importServerTaskResult(st)
}

function cancelAll() {
  ui.openConfirm('停止全部任务', '将停止所有本地任务，并取消仍在排队的服务端任务。确定继续？', '停止全部').then((ok) => {
    if (ok) ai.cancelAll()
  })
}
</script>

<style scoped>
.tq-title { margin-bottom: var(--space-md); }
.tq-section { margin: var(--space-md) 0 var(--space-sm); color: var(--text-secondary); }
.tq-server-head { display: flex; align-items: center; justify-content: space-between; margin-top: var(--space-lg); }
.tq-list { display: flex; flex-direction: column; gap: var(--space-sm); max-height: 320px; overflow-y: auto; padding-right: 4px; }
.task-item {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  background: var(--surface-card);
}
.task-item:hover { border-color: var(--color-primary); }
.task-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: var(--status-muted); }
.dot-running { background: var(--status-run); animation: pulse 1.2s infinite; }
.dot-pending { background: var(--status-queued); }
.dot-completed { background: var(--status-ok); }
.dot-failed { background: var(--status-fail); }
.task-main { flex: 1; min-width: 0; }
.task-title { font-size: var(--fs-base); font-weight: 500; }
.task-id { color: var(--text-muted); font-size: var(--fs-xs); font-weight: 400; }
.task-sub { font-size: var(--fs-xs); color: var(--text-muted); }
.task-error { font-size: var(--fs-xs); color: var(--color-danger); }
@keyframes pulse { 50% { opacity: 0.4; } }
@media (max-width: 768px) {
  .task-item { flex-wrap: wrap; }
  .task-main { flex: 1 1 60%; }
}
</style>