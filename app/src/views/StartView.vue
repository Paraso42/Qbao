<!-- 主页：hero + 统计 + 章节策略卡（AI 出题工作台） -->
<template>
  <section>
    <div class="start-hero">
      <div class="hero-mark">Q</div>
      <h1 class="hero-title">Qbao</h1>
      <p class="hero-sub">全能互动做题引擎 — 按章节刷题 · AI 智能出题 · 间隔复习</p>
      <div class="hero-actions">
        <button v-if="hasSubject" class="btn btn-ghost btn-small" @click="ui.showScreen('history')"><Icon name="clock" :size="14" /> 答题历史</button>
      </div>
      <div class="hero-actions" v-if="!hasSubject">
        <button class="btn btn-primary" @click="createFirstSubject">＋ 新建科目</button>
        <button class="btn btn-secondary" @click="ui.openImport">📥 导入题目</button>
      </div>
      <div v-if="hasSubject && ch" class="stat-cards">
        <div class="stat-card"><div class="stat-num tabular-nums">{{ rate }}%</div><div class="stat-label">章节正确率</div></div>
        <div class="stat-card"><div class="stat-num tabular-nums">{{ count }}</div><div class="stat-label">章节题量</div></div>
        <div class="stat-card"><div class="stat-num tabular-nums">{{ wrong }}</div><div class="stat-label">错题数</div></div>
      </div>
    </div>

    <div v-if="!hasSubject" class="card guide-card">
      <EmptyState icon="book" title="欢迎使用 Qbao" hint="从左侧边栏选择或新建章节开始学习，上传复习资料后可使用 AI 智能出题">
        <template #action>
          <button class="btn btn-primary btn-small" @click="createFirstSubject">＋ 新建科目</button>
        </template>
      </EmptyState>
    </div>

    <template v-if="ch">
      <!-- 快捷操作 -->
      <div class="card quick-card">
        <div class="quick-head">
          <div>
            <h3 class="quick-title">{{ ch.name }}</h3>
            <p class="quick-info">{{ quickInfo }}</p>
          </div>
          <button v-if="showQuickBtn" class="btn btn-primary btn-small" @click="onQuickAction">
            {{ quickLabel }}
          </button>
        </div>
      </div>

      <!-- 出题策略 -->
      <ChapterStrategyCard :chapter-id="ch.id" />

      <!-- 第四步：资料 + 生成 -->
      <div class="card">
        <template v-if="aiEnabled">
          <AiMaterialsSection :chapter-id="ch.id" />
          <div class="gen-area">
            <span class="gen-status">{{ genStatus }}</span>
            <button class="btn btn-success" :disabled="!canGenerate" @click="generate">
              <Icon name="sparkle" :size="16" /> 开始出题
            </button>
          </div>
        </template>
        <template v-else>
          <h4>把提示词复制给 AI</h4>
          <p class="trad-hint">全选后 Ctrl+C 复制，附带学习资料发给 AI，AI 会返回 JSON 格式的题目数据：</p>
          <div class="prompt-box">{{ promptText }}</div>
          <div class="trad-actions">
            <button class="btn btn-primary btn-small" @click="copyPrompt">👆 全选复制</button>
            <button class="btn btn-success btn-small" @click="ui.openImport">📥 导入题目数据 (JSON)</button>
          </div>
        </template>
      </div>
    </template>

    <div v-else-if="hasSubject" class="card">
      <EmptyState icon="book" title="还没有章节" hint="在左侧边栏选择科目后新建章节，即可开始刷题或 AI 出题" />
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import { useDataStore } from '../stores/data'
import { useSubjectStore } from '../stores/subjects'
import { useUiStore } from '../stores/ui'
import { useQuizStore } from '../stores/quiz'
import { useAiStore } from '../stores/ai'
import { useUserStore } from '../stores/user'
import { generatePromptText } from '../services/strategy'
import ChapterStrategyCard from '../components/features/strategy/ChapterStrategyCard.vue'
import AiMaterialsSection from '../components/features/ai/AiMaterialsSection.vue'
import Icon from '../components/ui/Icon.vue'
import EmptyState from '../components/ui/EmptyState.vue'

const data = useDataStore()
const subjects = useSubjectStore()
const ui = useUiStore()
const quiz = useQuizStore()
const ai = useAiStore()
const user = useUserStore()

const hasSubject = computed(() => subjects.list.length > 0)
const ch = computed(() => data.getCh())
const aiEnabled = computed(() => data.state.aiEnabled === true)
const strategy = computed(() => (ch.value ? data.getChStrategy(ch.value.id) : null))

const count = computed(() => (ch.value && ch.value.questions ? ch.value.questions.length : 0))
const answered = computed(() => {
  if (!ch.value || !ch.value.userAnswers) return 0
  return ch.value.userAnswers.filter((a) => a !== undefined && a !== null && a !== -1).length
})
const wrong = computed(() => {
  if (!ch.value || !ch.value.userAnswers) return 0
  let w = 0
  ch.value.userAnswers.forEach((a, i) => {
    if (a === undefined || a === null) return
    const q = ch.value.questions[i]
    if (q && q.answer !== undefined && a !== q.answer) w++
  })
  return w
})
const rate = computed(() => (answered.value > 0 ? Math.round((answered.value - wrong.value) / answered.value * 100) : 0))

const currentSet = computed(() => data.getCurrentQuizSet())
const setAnswered = computed(() => {
  const qs = currentSet.value
  if (!qs || !qs.userAnswers) return 0
  return qs.userAnswers.filter((a) => a !== undefined && a !== -1).length
})
const setTotal = computed(() => (currentSet.value ? currentSet.value.questions.length : 0))
const showQuickBtn = computed(() => setTotal.value > 0)
const quickLabel = computed(() => (setAnswered.value >= setTotal.value ? '📊 查看报告' : '▶️ 继续答题'))
const quickInfo = computed(() => {
  if (setTotal.value > 0) return '共 ' + setTotal.value + ' 题，已答 ' + setAnswered.value + ' 题'
  return '暂无题目，请先导入或 AI 出题'
})

function onQuickAction() {
  if (setAnswered.value >= setTotal.value && setTotal.value > 0) quiz.openQuiz('report')
  else quiz.startSession()
}

function createFirstSubject() {
  subjects.create('我的科目')
}

// AI 生成
const materials = computed(() => (ch.value ? ai.getChapterMaterials(ch.value.id) : []))
const hasTask = computed(() => (ch.value ? ai.hasTaskForChapter(ch.value.id) : false))
const canGenerate = computed(() => {
  if (!ch.value) return false
  if (materials.value.length === 0) return false
  if (!user.isOnline) return false
  if (hasTask.value) return false
  const tc = strategy.value ? strategy.value.typeCounts : null
  if (!tc) return false
  return (tc.single + tc.judge + tc.term + tc.short) > 0
})
const genStatus = computed(() => {
  if (!ch.value) return '请先选择一个章节'
  if (materials.value.length === 0) return '请先上传复习资料'
  if (!user.isOnline) return '请先登录'
  if (hasTask.value) return '该章节已有任务在队列中'
  return '已准备就绪，共 ' + materials.value.length + ' 份资料'
})

function generate() {
  if (!ch.value || !strategy.value) return
  ai.enqueueGenerate(ch.value.id, { ...strategy.value.typeCounts })
}

const promptText = computed(() => (ch.value ? generatePromptText(data.state, ch.value.id) : ''))

async function copyPrompt() {
  try {
    await navigator.clipboard.writeText(promptText.value)
    ui.toast('提示词已复制', 'ok')
  } catch (e) {
    // 桌面/旧浏览器降级：选中文本
    const el = document.querySelector('.prompt-box')
    if (el) {
      const range = document.createRange()
      range.selectNodeContents(el)
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
      ui.toast('已全选，请按 Ctrl+C 复制', 'info')
    }
  }
}
</script>

<style scoped>
.start-hero { text-align: center; padding: 40px 20px 8px; }
.hero-mark {
  width: 68px; height: 68px;
  margin: 0 auto 14px;
  display: flex; align-items: center; justify-content: center;
  font-size: 32px; font-weight: 700; color: #fff;
  border-radius: var(--radius-xl);
  background: var(--gradient-primary);
  box-shadow: var(--shadow-lg);
}
.hero-title { margin-bottom: var(--space-sm); }
.hero-sub { color: var(--text-secondary); margin-bottom: var(--space-lg); }
.hero-actions { display: flex; justify-content: center; gap: var(--space-sm); }
.stat-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-md);
  margin-top: var(--space-xl);
  text-align: left;
}
.stat-card {
  background: var(--surface-card);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  padding: var(--space-lg);
  transition: box-shadow var(--transition-normal), border-color var(--transition-normal);
}
.stat-card:hover { border-color: var(--color-primary); box-shadow: var(--shadow-md); }
.stat-num { font-size: var(--fs-2xl); font-weight: 700; letter-spacing: -0.5px; }
.stat-label { font-size: var(--fs-sm); color: var(--text-secondary); margin-top: 4px; }
.guide-card { margin-top: var(--space-lg); }
.quick-card { margin-top: var(--space-lg); }
.quick-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-md); }
.quick-title { margin: 0; }
.quick-info { color: var(--text-secondary); font-size: var(--fs-sm); margin-top: 2px; }
.trad-hint { color: var(--text-muted); font-size: var(--fs-xs); margin-bottom: var(--space-sm); }
.prompt-box {
  background: var(--surface-hover);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  padding: var(--space-md);
  font-size: var(--fs-sm);
  line-height: var(--lh-relaxed);
  max-height: 220px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--text-secondary);
  margin-bottom: var(--space-sm);
}
.trad-actions { display: flex; gap: var(--space-sm); flex-wrap: wrap; }
.gen-area {
  margin-top: var(--space-lg);
  padding-top: var(--space-lg);
  border-top: 1px solid var(--border-light);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  flex-wrap: wrap;
}
.gen-status { font-size: var(--fs-sm); color: var(--text-muted); }
@media (max-width: 768px) {
  .stat-cards { grid-template-columns: 1fr; }
  .gen-area { flex-direction: column; align-items: stretch; }
  .gen-area .btn { width: 100%; }
}
</style>
