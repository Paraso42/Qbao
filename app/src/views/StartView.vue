<!-- 主页：紧凑 hero + 统计 + 章节工作台（AI 出题） -->
<template>
  <section>
    <div class="start-hero">
      <div class="hero-mark">Q</div>
      <h1 class="hero-title">Qbao</h1>
      <p class="hero-sub">按章节刷题 · AI 智能出题 · 间隔复习</p>
      <div v-if="hasSubject && ch" class="hero-actions">
        <button class="btn btn-secondary btn-small" @click="ui.showScreen('history')"><Icon name="clock" :size="14" /> 答题历史</button>
        <button class="btn btn-ghost btn-small" @click="ui.openImport"><Icon name="upload" :size="14" /> 导入题目</button>
      </div>
      <div class="hero-actions" v-else-if="!hasSubject">
        <button class="btn btn-primary" @click="createFirstSubject"><Icon name="plus" :size="15" /> 新建科目</button>
        <button class="btn btn-secondary" @click="ui.openImport"><Icon name="upload" :size="15" /> 导入题目</button>
      </div>
    </div>

    <div v-if="hasSubject && ch" class="stat-cards">
      <div class="stat-card"><div class="stat-num tabular-nums">{{ rate }}<span class="stat-unit">%</span></div><div class="stat-label">章节正确率</div></div>
      <div class="stat-card"><div class="stat-num tabular-nums">{{ count }}</div><div class="stat-label">章节题量</div></div>
      <div class="stat-card"><div class="stat-num tabular-nums">{{ wrong }}</div><div class="stat-label">待巩固错题</div></div>
    </div>

    <div v-if="!hasSubject" class="card guide-card">
      <EmptyState icon="book" title="欢迎使用 Qbao" hint="从左侧边栏选择或新建章节开始学习，上传复习资料后可使用 AI 智能出题">
        <template #action>
          <button class="btn btn-primary btn-small" @click="createFirstSubject"><Icon name="plus" :size="13" /> 新建科目</button>
        </template>
      </EmptyState>
    </div>

    <template v-if="ch">
      <!-- AI 服务不可用：持久化警告条（一次性事件才用 toast） -->
      <div v-if="aiEnabled && ai.providersError" class="ai-warn">
        <Icon name="warning" :size="15" />
        <span>AI 服务暂不可用：{{ ai.providersError }}</span>
        <button class="ai-warn-link" @click="ui.openSettings('aiconfig')">前往配置</button>
      </div>

      <!-- 章节工作台 -->
      <div class="card quick-card">
        <div class="quick-head">
          <div>
            <h3 class="quick-title">{{ ch.name }}</h3>
            <p class="quick-info">{{ quickInfo }}</p>
          </div>
          <button v-if="showQuickBtn" class="btn btn-primary btn-small" @click="onQuickAction">
            <Icon :name="setFinished ? 'chart' : 'book'" :size="14" /> {{ quickLabel }}
          </button>
        </div>
      </div>

      <!-- 出题策略 -->
      <ChapterStrategyCard :chapter-id="ch.id" />

      <!-- 资料 + 生成 -->
      <div class="card">
        <template v-if="aiEnabled">
          <AiMaterialsSection :chapter-id="ch.id" />
          <div class="gen-area">
            <span class="gen-status">{{ genStatus }}</span>
            <button class="btn btn-primary" :disabled="!canGenerate" @click="generate">
              <Icon name="sparkle" :size="15" /> 开始出题
            </button>
          </div>
          <p v-if="aiQuotaHint" class="quota-hint">{{ aiQuotaHint }}</p>
        </template>
        <template v-else>
          <h4>把提示词复制给 AI</h4>
          <p class="trad-hint">全选后 Ctrl+C 复制，附带学习资料发给 AI，AI 会返回 JSON 格式的题目数据：</p>
          <div class="prompt-box">{{ promptText }}</div>
          <div class="trad-actions">
            <button class="btn btn-primary btn-small" @click="copyPrompt"><Icon name="file" :size="13" /> 全选复制</button>
            <button class="btn btn-secondary btn-small" @click="ui.openImport"><Icon name="upload" :size="13" /> 导入题目数据 (JSON)</button>
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
import { usePointsStore } from '../stores/points'
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
const points = usePointsStore()

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
const setFinished = computed(() => setAnswered.value >= setTotal.value)
const quickLabel = computed(() => (setFinished.value ? '查看报告' : setAnswered.value > 0 ? '继续答题' : '开始刷题'))
const quickInfo = computed(() => {
  if (setTotal.value > 0) return '共 ' + setTotal.value + ' 题，已答 ' + setAnswered.value + ' 题'
  return '暂无题目，请先导入或 AI 出题'
})

function onQuickAction() {
  if (setFinished.value && setTotal.value > 0) quiz.openQuiz('report')
  else quiz.startSession()
}

function createFirstSubject() {
  subjects.create('我的科目')
}

// AI 生成
const materials = computed(() => (ch.value ? ai.getChapterMaterials(ch.value.id) : []))
const hasTask = computed(() => (ch.value ? ai.hasTaskForChapter(ch.value.id) : false))
// 本章节仍有未做完的题目 → 不允许继续出题（K1 规则；服务端同样有 409 兜底）
const hasUnfinishedSet = computed(() => {
  const qs = data.getCurrentQuizSet()
  if (!qs || !qs.questions || qs.questions.length === 0) return false
  const unanswered = (qs.userAnswers || [])
    .filter((a) => a === undefined || a === null || a === -1).length
  return unanswered > 0
})
const canGenerate = computed(() => {
  if (!ch.value) return false
  if (materials.value.length === 0) return false
  if (!user.isOnline) return false
  if (hasTask.value) return false
  if (hasUnfinishedSet.value) return false
  const tc = (strategy.value && strategy.value.typeCounts) ? strategy.value.typeCounts : null
  if (!tc) return false
  return ((tc.single || 0) + (tc.judge || 0) + (tc.term || 0) + (tc.short || 0)) > 0
})
const genStatus = computed(() => {
  if (!ch.value) return '请先选择一个章节'
  if (materials.value.length === 0) return '请先上传复习资料'
  if (!user.isOnline) return '请先登录'
  if (hasTask.value) return '该章节已有任务在队列中'
  if (hasUnfinishedSet.value) return '本章节还有未做完的题目，请先完成本轮答题'
  return '已准备就绪，共 ' + materials.value.length + ' 份资料'
})

// AI 出题配额提示（points 接口数据；仅提示，服务端为准）
let quotaLoaded = false
const aiQuotaHint = computed(() => {
  if (!quotaLoaded) {
    quotaLoaded = true
    points.loadQuota()
  }
  const q = points.quota
  if (!q) return ''
  if (q.aiGenerateUsed < q.aiGenerateFree) {
    return 'AI 出题今日免费额度余 ' + (q.aiGenerateFree - q.aiGenerateUsed) + ' 次'
  }
  if (points.balance >= q.aiGenerateOverCost) {
    return '今日免费额度已用完，本次出题将消耗 ' + q.aiGenerateOverCost + ' 积分'
  }
  return '今日免费额度已用完且积分不足，AI 出题将无法进行（可在用户中心「积分」页查看获取方式）'
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
.start-hero { text-align: center; padding: var(--space-3xl) 20px var(--space-lg); }
.hero-mark {
  width: 48px; height: 48px;
  margin: 0 auto var(--space-md);
  display: flex; align-items: center; justify-content: center;
  font-size: 24px; font-weight: 700; color: #fff;
  border-radius: var(--radius-xl);
  background: var(--gradient-primary);
  box-shadow: var(--shadow-sm);
}
.hero-title { font-size: var(--fs-2xl); margin-bottom: var(--space-xs); }
.hero-sub { color: var(--text-muted); font-size: var(--fs-sm); margin-bottom: var(--space-lg); }
.hero-actions { display: flex; justify-content: center; gap: var(--space-sm); flex-wrap: wrap; }
.stat-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-md);
  margin: var(--space-md) 0;
  text-align: left;
}
.stat-card {
  background: var(--surface-card);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-card);
  padding: var(--space-lg);
  transition: border-color var(--transition-normal), box-shadow var(--transition-normal);
}
.stat-card:hover { border-color: var(--color-primary); box-shadow: var(--shadow-sm); }
.stat-num { font-size: var(--fs-2xl); font-weight: 700; letter-spacing: -0.5px; line-height: 1.3; }
.stat-unit { font-size: var(--fs-base); font-weight: 600; color: var(--text-muted); margin-left: 1px; }
.stat-label { font-size: var(--fs-xs); color: var(--text-muted); margin-top: 4px; }
.guide-card { margin-top: var(--space-lg); }
.ai-warn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  margin-bottom: var(--space-md);
  background: var(--color-warning-light);
  border: 1px solid rgba(245, 158, 11, 0.35);
  border-radius: var(--radius-card);
  color: var(--color-warning);
  font-size: var(--fs-sm);
}
.ai-warn span { flex: 1; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ai-warn-link { color: var(--color-warning); font-weight: 500; flex-shrink: 0; }
.ai-warn-link:hover { text-decoration: underline; }
.quick-card { margin-top: var(--space-lg); }
.quick-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-md); flex-wrap: wrap; }
.quick-title { margin: 0; }
.quick-info { color: var(--text-muted); font-size: var(--fs-sm); margin-top: 2px; }
.trad-hint { color: var(--text-muted); font-size: var(--fs-xs); margin-bottom: var(--space-sm); }
.prompt-box {
  background: var(--surface-panel);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  padding: var(--space-md);
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  line-height: var(--lh-relaxed);
  max-height: 220px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--text-secondary);
  margin-bottom: var(--space-sm);
}
.trad-actions { display: flex; gap: var(--space-sm); flex-wrap: wrap; }
.quota-hint { font-size: var(--fs-xs); color: var(--text-secondary); margin-top: var(--space-sm); }
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
  .start-hero { padding-top: var(--space-2xl); }
  .stat-cards { grid-template-columns: 1fr; gap: var(--space-sm); }
  .gen-area { flex-direction: column; align-items: stretch; }
  .gen-area .btn { width: 100%; }
}
</style>