<!-- 科目总览（总览/题库/大考卷/SRS，自 legacy dashboard.js + exam.js 迁移，DeepSeek 风格） -->
<template>
  <section>
    <div class="sd-head">
      <h1>{{ subj ? subj.name : '科目总览' }}</h1>
      <button class="btn btn-secondary btn-small" @click="ui.showScreen('start')">← 返回主页</button>
    </div>

    <div class="tabs sd-tabs">
      <div v-for="t in tabs" :key="t.key" class="tab" :class="{ active: tab === t.key }" @click="tab = t.key">{{ t.label }}</div>
    </div>

    <!-- 总览 -->
    <div v-if="tab === 'overview'" class="sd-content">
      <div class="sd-grid">
        <div class="sd-card"><div class="num tabular-nums">{{ subj ? subj.chapterIds.length : 0 }}</div><div class="label">章节</div></div>
        <div class="sd-card"><div class="num tabular-nums">{{ overview.totalQs }}</div><div class="label">当前题数</div></div>
        <div class="sd-card"><div class="num tabular-nums">{{ overview.totalRounds }}</div><div class="label">总轮次</div></div>
        <div class="sd-card"><div class="num tabular-nums">{{ overview.histAnswered }}</div><div class="label">累计答题</div></div>
        <div class="sd-card"><div class="num ok tabular-nums">{{ overview.histCorrect }}</div><div class="label">正确</div></div>
        <div class="sd-card"><div class="num bad tabular-nums">{{ overview.histWrong }}</div><div class="label">错误</div></div>
        <div class="sd-card"><div class="num primary tabular-nums">{{ overview.rate }}%</div><div class="label">正确率</div></div>
      </div>

      <div v-if="overview.chStats.length" class="card">
        <h4>各章节正确率</h4>
        <div v-for="cs in overview.chStats" :key="cs.name" class="ch-rate-row">
          <div class="ch-rate-head"><span>{{ cs.name }}</span><span class="tabular-nums">{{ cs.rate }}% ({{ cs.correct }}/{{ cs.total }})</span></div>
          <div class="progress-bar"><div class="fill" :style="{ width: cs.rate + '%', background: rateColor(cs.rate) }"></div></div>
        </div>
      </div>

      <div v-if="overview.rates.length >= 2" class="card">
        <h4>实力趋势 <span class="trend-text">{{ overview.trendText }}</span></h4>
        <div class="sparkline">
          <div v-for="(r, i) in overview.rates" :key="i" class="spark-bar" :style="{ height: Math.max(r, 5) + '%', background: rateColor(r) }" :title="'第' + (i + 1) + '轮: ' + r + '%'"></div>
        </div>
      </div>

      <div v-if="overview.chStats.length >= 2" class="card">
        <h4>最佳与待提升</h4>
        <div class="best-worst">
          <div class="bw-card ok"><span class="bw-label">🥇 最佳章节</span><span class="bw-value">{{ best.name }} {{ best.rate }}%</span></div>
          <div class="bw-card bad"><span class="bw-label">📌 待提升</span><span class="bw-value">{{ worst.name }} {{ worst.rate }}%</span></div>
        </div>
      </div>

      <div class="card">
        <h4>题型分布</h4>
        <div class="type-bar">
          <div v-for="t in typeSegs" :key="t.type" class="type-seg" :style="{ width: t.pct + '%', background: typeColors[t.type] }">{{ typeNames[t.type] }}</div>
        </div>
        <div class="type-legend">
          <span v-for="t in typeSegs" :key="t.type" class="legend-item"><span class="legend-dot" :style="{ background: typeColors[t.type] }"></span>{{ typeNames[t.type] }} {{ t.count }}</span>
        </div>
      </div>
    </div>

    <!-- 题库 -->
    <div v-else-if="tab === 'questionbank'" class="sd-content">
      <div class="qbank-toolbar">
        <label class="qb-check"><input type="checkbox" v-model="qbOnlyWrong"> 仅显示错题</label>
        <div class="qb-search"><Icon name="search" :size="14" /><input v-model="qbKeyword" class="qb-input" type="text" placeholder="搜索题目/标签..."></div>
      </div>
      <div v-for="group in qbankGroups" :key="group.cid" class="card qb-group">
        <h4 class="qb-header">{{ group.chName }} <span class="qb-meta">{{ group.ch.questions ? group.ch.questions.length : 0 }} 题 · {{ group.rounds }} 次答题</span></h4>
        <div v-if="group.items.length === 0" class="qb-empty">无匹配题目</div>
        <div v-for="item in group.items" :key="item.key" class="qb-item" :class="item.ci === true ? 'correct' : (item.ci === false ? 'wrong' : '')" @click="openDetail(item)">
          <p class="qb-q"><span class="qb-icon">{{ item.ci === true ? '✅' : (item.ci === false ? '❌' : '⏳') }}</span>[{{ typeShort[item.q.type] || item.q.type }}] {{ item.q.tag || '' }}：{{ shortText(item.q.question, 60) }}</p>
          <p v-if="item.q.explanation" class="qb-detail">{{ shortText(item.q.explanation, 80) }}</p>
        </div>
      </div>
    </div>

    <!-- 大考卷 -->
    <div v-else-if="tab === 'compose-exam'" class="sd-content">
      <div class="card">
        <h3>大考卷 — {{ subj ? subj.name : '' }}</h3>
        <p class="ce-hint">从本科目各章节中抽取题目，组成综合试卷。</p>
        <h4>1. 选择章节</h4>
        <div class="ce-chapters">
          <label v-for="cid in subj.chapterIds" :key="cid" class="ce-ch" v-if="data.state.chapters[cid]">
            <input type="checkbox" :value="cid" v-model="checkedCids" @change="resetWeights">
            <span class="ce-ch-name">{{ data.state.chapters[cid].name }}</span>
            <span class="ce-ch-count tabular-nums">{{ data.state.chapters[cid].questions ? data.state.chapters[cid].questions.length : 0 }} 题</span>
          </label>
        </div>

        <h4>2. 各题型数量</h4>
        <div class="type-counts">
          <div v-for="t in examTypes" :key="t.key" class="type-count-item">
            <label>{{ t.label }}</label>
            <div class="num-picker">
              <button class="num-btn" @click="examTc[t.key] = Math.max(0, examTc[t.key] - 5)">−</button>
              <input v-model.number="examTc[t.key]" class="num-input" type="number" min="0" max="50">
              <button class="num-btn" @click="examTc[t.key] = Math.min(50, examTc[t.key] + 5)">+</button>
            </div>
          </div>
        </div>
        <p class="ce-total">总题数：{{ examTotal }} 题</p>

        <h4>3. 章节占比（总和100%）</h4>
        <p v-if="checkedCids.length === 0" class="ce-empty">请先勾选章节</p>
        <p v-else-if="checkedCids.length === 1" class="ce-empty">仅一个章节占比固定 100%</p>
        <div v-else>
          <div class="cum-track">
            <div v-for="(w, i) in weights" :key="i" class="cum-seg" :style="segStyle(i)"></div>
            <input v-for="(s, i) in cumSliders" :key="'s' + i" type="range" min="0" max="100" step="1" :value="s" @input="onCumSlider(i, $event)">
          </div>
          <div class="cum-labels">
            <div v-for="(cid, i) in checkedCids" :key="cid" class="cum-row">
              <span class="cum-dot" :style="{ background: examColors[i % 10] }"></span>
              <span class="cum-name">{{ data.state.chapters[cid] ? data.state.chapters[cid].name : '未知' }}</span>
              <input v-model.number="weights[i]" class="cum-input" type="number" min="1" max="99" @change="onWeightInput(i)">
            </div>
          </div>
        </div>

        <h4>4. 出题策略（不含新题）</h4>
        <div class="strategy-labels">
          <span>🔴 针对错题 <input v-model.number="examErrPct" class="pct-input" type="number" min="0" max="100">%</span>
          <span>🟡 滚动复习 {{ 100 - examErrPct }}%</span>
        </div>
        <div class="dual-range-wrap">
          <div class="dual-track-bg"></div>
          <div class="dual-track-fill err" :style="{ width: examErrPct + '%' }"></div>
          <div class="dual-track-fill review" :style="{ width: (100 - examErrPct) + '%', left: examErrPct + '%' }"></div>
          <input type="range" min="0" max="100" step="1" :value="examErrPct" @input="examErrPct = parseInt($event.target.value) || 0">
        </div>

        <div class="ce-actions">
          <button class="btn btn-success" @click="compose">生成大考卷</button>
        </div>
      </div>

      <div class="card">
        <h4>历史试卷</h4>
        <div v-if="examList.length === 0" class="qb-empty">暂无历史试卷</div>
        <div v-for="ex in examList" :key="ex.id" class="exam-item" @click="quiz.startExam(ex.id)">
          <span class="exam-icon">📝</span>
          <div class="exam-main">
            <div class="exam-name">{{ ex.name }}</div>
            <div class="exam-meta">{{ ex.questions.length }} 题 · {{ new Date(ex.createdAt).toLocaleString('zh-CN') }}</div>
          </div>
          <button class="btn btn-primary btn-small">开始答题</button>
        </div>
      </div>
    </div>

    <!-- SRS -->
    <div v-else-if="tab === 'srs-review'" class="sd-content">
      <div class="card">
        <h3>间隔复习</h3>
        <p class="ce-hint">基于 SM-2 算法的间隔重复复习，到期题目将在此列出。</p>
        <div class="srs-hero">
          <div class="srs-count"><span class="srs-num tabular-nums">{{ dueCount }}</span><span class="srs-label">今日到期</span></div>
          <button class="btn btn-primary" :disabled="dueCount === 0" @click="quiz.startSrsReview">开始复习</button>
        </div>
        <div v-if="dueCount === 0" class="qb-empty">暂无待复习题目，继续保持！</div>
        <div v-for="item in dueItems" :key="item.qid" class="srs-item">
          <span class="srs-icon">📅</span>
          <div class="srs-main">
            <div class="srs-q">{{ shortText(item.q.question, 80) }}</div>
            <div class="srs-meta">{{ item.srs.repetitions }} 次复习 · 间隔 {{ item.srs.interval }} 天</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 题目详情 -->
    <Modal :open="!!detail" @close="detail = null">
      <div v-if="detail" class="qdetail">
        <h3 class="qd-title">题目详情{{ detail.roundIdx >= 0 ? ' (第' + (detail.roundIdx + 1) + '轮)' : '' }}</h3>
        <p class="qd-q"><strong>[{{ typeNames[detail.q.type] || detail.q.type }}]</strong> <span v-html="renderMarkdown(detail.q.question)"></span></p>
        <div v-if="isObjType(detail.q.type)" class="qd-options">
          <div v-for="(opt, i) in (detail.q.options || [])" :key="i" class="qd-opt" :class="{ ok: i === detail.q.answer }">
            {{ letter(i) }}. <span v-html="renderMarkdown(opt)"></span>
          </div>
        </div>
        <div v-if="detail.q.userAnswer !== undefined" class="qd-ans" :class="detail.q.isCorrect === true ? 'ok' : (detail.q.isCorrect === false ? 'bad' : '')">
          你的答案：{{ detail.q.userAnswer }}
        </div>
        <div v-if="detail.q.explanation" class="qd-exp"><h4>解析</h4><p v-html="renderMarkdown(detail.q.explanation)"></p></div>
      </div>
      <div class="dialog-actions"><button class="btn btn-secondary btn-small" @click="detail = null">关闭</button></div>
    </Modal>
  </section>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useDataStore } from '../stores/data'
import { useSubjectStore } from '../stores/subjects'
import { useUiStore } from '../stores/ui'
import { useQuizStore } from '../stores/quiz'
import { isObjType, getCi } from '../services/utils'
import { getQuestionId, calcStats } from '../services/questions'
import { getSrsDueQuestions } from '../services/srs'
import { composeSubjExam, getExamSettings } from '../services/exam'
import { renderMarkdown } from '../services/utils'
import Icon from '../components/ui/Icon.vue'
import Modal from '../components/ui/Modal.vue'

const data = useDataStore()
const subjects = useSubjectStore()
const ui = useUiStore()
const quiz = useQuizStore()

const tabs = [
  { key: 'overview', label: '总览' },
  { key: 'questionbank', label: '题库' },
  { key: 'compose-exam', label: '大考卷' },
  { key: 'srs-review', label: '间隔复习' }
]
const tab = ref('overview')
const detail = ref(null)
function openDetail(item) {
  detail.value = {
    q: item.q,
    roundIdx: item.roundIdx,
    qIdx: item.qIdx
  }
}
function letter(i) { return String.fromCharCode(65 + i) }
const subj = computed(() => data.getSubj())
const typeNames = { single: '单选', judge: '判断', term: '名词解释', short: '简答' }
const typeShort = { single: '单选', judge: '判断', term: '名解', short: '简答' }
const typeColors = { single: '#4D6BFE', judge: '#F59E0B', term: '#8B5CF6', short: '#EF4444' }
const examColors = ['#EF4444', '#F59E0B', '#10B981', '#4D6BFE', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#84CC16']

function rateColor(rate) {
  if (rate >= 70) return '#10B981'
  if (rate >= 40) return '#F59E0B'
  return '#EF4444'
}
function shortText(t, n) {
  const s = String(t || '')
  return s.length > n ? s.substring(0, n) + '...' : s
}

// —— 总览 ——
const overview = computed(() => {
  const s = subj.value
  const out = { totalQs: 0, totalRounds: 0, histAnswered: 0, histCorrect: 0, histWrong: 0, rate: 0, chStats: [], rates: [], trendText: '' }
  if (!s) return out
  const typeDist = { single: 0, judge: 0, term: 0, short: 0 }
  s.chapterIds.forEach((cid) => {
    out.totalRounds += (data.state.history || []).filter((r) => r.chapterId === cid).length
    const ch = data.state.chapters[cid]
    if (!ch || !ch.questions) return
    out.totalQs += ch.questions.length
    let cCor = 0, cTot = 0, cAns = 0, cWr = 0
    ch.questions.forEach((q, i) => {
      typeDist[q.type] = (typeDist[q.type] || 0) + 1
      if (ch.userAnswers[i] !== undefined) cAns++
      if (isObjType(q.type)) {
        cTot++
        const ci = getCi(q, ch.userAnswers[i])
        if (ci === true) cCor++
        else if (ci === false) cWr++
      }
    })
    out.chStats.push({ name: ch.name, rate: cTot > 0 ? Math.round(cCor / cTot * 100) : 0, total: cTot, correct: cCor, wrong: cWr, answered: cAns })
  })
  ;(data.state.history || []).forEach((r) => {
    if (!s.chapterIds.includes(r.chapterId) || !r.questions) return
    r.questions.forEach((q) => {
      if (q.userAnswer !== undefined) out.histAnswered++
      if (isObjType(q.type)) {
        if (q.isCorrect === true) out.histCorrect++
        else if (q.isCorrect === false) out.histWrong++
      }
    })
  })
  const objTotal = out.histCorrect + out.histWrong
  out.rate = objTotal > 0 ? Math.round(out.histCorrect / objTotal * 100) : (out.histAnswered > 0 ? 100 : 0)

  const allRounds = (data.state.history || []).filter((r) => s.chapterIds.includes(r.chapterId) && r.questions && r.questions.length > 0)
  out.rates = allRounds.map((r) => r.rate || 0)
  if (out.rates.length >= 2) {
    const rates = out.rates
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0
    const n = rates.length
    for (let i = 0; i < n; i++) { sumX += i; sumY += rates[i]; sumXY += i * rates[i]; sumXX += i * i }
    const slope = (n * sumXY - sumX * sumY) / ((n * sumXX - sumX * sumX) || 1)
    if (slope > 2) out.trendText = '📈 实力提升中（每轮平均 +' + slope.toFixed(1) + '%）'
    else if (slope < -2) out.trendText = '📉 实力下降中（每轮平均 ' + slope.toFixed(1) + '%）'
    else out.trendText = '➡️ 实力稳定（每轮变化 ' + slope.toFixed(1) + '%）'
  }
  out.typeDist = typeDist
  return out
})

const best = computed(() => {
  const sorted = [...overview.value.chStats].sort((a, b) => b.rate - a.rate)
  return sorted[0] || { name: '-', rate: 0 }
})
const worst = computed(() => {
  const sorted = [...overview.value.chStats].sort((a, b) => b.rate - a.rate)
  return sorted[sorted.length - 1] || { name: '-', rate: 0 }
})
const typeSegs = computed(() => {
  const dist = overview.value.typeDist || {}
  const total = Object.values(dist).reduce((a, b) => a + b, 0) || 1
  return Object.keys(dist).filter((t) => dist[t] > 0).map((t) => ({ type: t, count: dist[t], pct: Math.round(dist[t] / total * 100) }))
})

// —— 题库 ——
const qbOnlyWrong = ref(false)
const qbKeyword = ref('')
const qbankGroups = computed(() => {
  const s = subj.value
  if (!s) return []
  const kw = qbKeyword.value.trim().toLowerCase()
  return s.chapterIds.map((cid) => {
    const ch = data.state.chapters[cid]
    if (!ch) return null
    const history = (data.state.history || []).filter((r) => r.chapterId === cid)
    const items = []
    history.forEach((r, ri) => {
      if (!r.questions) return
      r.questions.forEach((q, qi) => {
        const ci = q.isCorrect
        if (qbOnlyWrong.value && ci !== false) return
        if (kw && !(q.question && q.question.toLowerCase().includes(kw)) && !(q.tag && q.tag.toLowerCase().includes(kw)) && !(q.explanation && q.explanation.toLowerCase().includes(kw))) return
        items.push({ key: cid + ':' + ri + ':' + qi, q, ci, roundIdx: ri, qIdx: qi })
      })
    })
    return { cid, chName: ch.name, ch, rounds: history.length, items }
  }).filter(Boolean)
})

// —— 大考卷 ——
const examTypes = [
  { key: 'single', label: '📝 单选' },
  { key: 'judge', label: '⚖️ 判断' },
  { key: 'term', label: '📖 名词解释' },
  { key: 'short', label: '✍️ 简答' }
]
const es = computed(() => (subj.value ? getExamSettings(data.state, subj.value.id) : null))
const checkedCids = ref([])
const examTc = ref({ single: 20, judge: 10, term: 5, short: 1 })
const examErrPct = ref(30)
const cumSliders = ref([])
const weights = ref([])

function initExamForm() {
  const s = subj.value
  if (!s || !es.value) return
  examTc.value = { ...es.value.typeCounts }
  examErrPct.value = es.value.errPct
  checkedCids.value = (es.value._checkedCids || []).filter((cid) => s.chapterIds.includes(cid))
  resetWeights(false)
}
function resetWeights() {
  const n = checkedCids.value.length
  if (n <= 1) { cumSliders.value = []; weights.value = n === 1 ? [100] : []; return }
  const arr = []
  for (let i = 0; i < n - 1; i++) arr.push(Math.round((i + 1) * 100 / n))
  cumSliders.value = arr
  recomputeWeights()
}
function recomputeWeights() {
  const n = checkedCids.value.length
  if (n === 0) { weights.value = []; return }
  if (n === 1) { weights.value = [100]; return }
  const pcts = []
  let prev = 0
  for (let i = 0; i < n; i++) {
    const cur = i < n - 1 ? cumSliders.value[i] : 100
    pcts.push(cur - prev)
    prev = cur
  }
  weights.value = pcts
}
function segStyle(i) {
  const left = weights.value.slice(0, i).reduce((a, b) => a + b, 0)
  return { width: weights.value[i] + '%', left: left + '%', background: examColors[i % 10] }
}
function onCumSlider(i, e) {
  const n = checkedCids.value.length
  const val = parseInt(e.target.value) || 0
  const leftBound = i > 0 ? cumSliders.value[i - 1] : 0
  const rightBound = i < n - 2 ? cumSliders.value[i + 1] : 100
  cumSliders.value[i] = Math.max(leftBound, Math.min(rightBound, val))
  recomputeWeights()
}
function onWeightInput(idx) {
  const n = checkedCids.value.length
  if (n < 2) return
  const newVal = Math.max(1, Math.min(99, parseInt(weights.value[idx]) || 0))
  const pcts = [...weights.value]
  const delta = newVal - pcts[idx]
  if (delta === 0) return
  if (idx === n - 1) pcts[idx - 1] -= delta
  else pcts[idx + 1] -= delta
  pcts[idx] += delta
  for (let i = 0; i < n; i++) {
    if (pcts[i] < 1) {
      if (i < n - 1) { pcts[i + 1] -= (1 - pcts[i]); pcts[i] = 1 }
      else if (i > 0) { pcts[i - 1] -= (1 - pcts[i]); pcts[i] = 1 }
    }
    if (pcts[i] > 99) pcts[i] = 99
  }
  const newSliders = []
  let cum = 0
  for (let i = 0; i < n - 1; i++) { cum += pcts[i]; newSliders.push(cum) }
  cumSliders.value = newSliders
  weights.value = pcts
}
const examTotal = computed(() => examTc.value.single + examTc.value.judge + examTc.value.term + examTc.value.short)
const examList = computed(() => {
  const s = subj.value
  if (!s) return []
  return Object.values(data.state.generatedExams || {}).filter((e) => e.subjectId === s.id && e.type === 'exam').sort((a, b) => b.createdAt - a.createdAt)
})

function compose() {
  const s = subj.value
  if (!s || !es.value) return
  if (checkedCids.value.length === 0) { ui.toast('请至少选择一个章节', 'err'); return }
  const w = weights.value.length === checkedCids.value.length ? weights.value : checkedCids.value.map(() => Math.floor(100 / checkedCids.value.length))
  const result = composeSubjExam(data.state, s.id, checkedCids.value.slice(), { ...examTc.value }, w)
  if (result.error) { ui.toast(result.error, 'err'); return }
  // 记忆设置
  es.value.typeCounts = { ...examTc.value }
  es.value.errPct = examErrPct.value
  es.value.reviewPct = 100 - examErrPct.value
  es.value.newPct = 0
  es.value._checkedCids = checkedCids.value.slice()
  es.value._examCumSliders = cumSliders.value.slice()
  data.saveState()
  ui.toast('✅ 大考卷已生成：共 ' + result.exam.questions.length + ' 题', 'ok')
  quiz.startExam(result.exam.id)
}

// —— SRS ——
const dueCount = computed(() => getSrsDueQuestions(data.state).length)
const dueItems = computed(() => {
  return getSrsDueQuestions(data.state).map((qid) => {
    const srs = data.state.srsData[qid]
    let q = null
    for (const cid in data.state.chapters) {
      const ch = data.state.chapters[cid]
      if (!ch || !ch.questions) continue
      for (const qq of ch.questions) {
        if (getQuestionId(cid, qq) === qid) { q = qq; break }
      }
      if (q) break
    }
    return { qid, srs, q: q || { question: '(题目已删除)' } }
  })
})

// 切到该视图时初始化
watch(() => ui.activeScreen, (screen) => {
  if (screen === 'subject-dash') {
    tab.value = 'overview'
    initExamForm()
  }
}, { immediate: true })
</script>

<style scoped>
.sd-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-md); flex-wrap: wrap; gap: var(--space-sm); }
.sd-head h1 { margin: 0; }
.sd-tabs { margin-bottom: var(--space-lg); }
.sd-content { animation: screenFadeIn 0.25s ease; }
@keyframes screenFadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
.sd-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-sm); margin-bottom: var(--space-md); }
.sd-card { background: var(--surface-card); border: 1px solid var(--border-light); border-radius: var(--radius-lg); padding: var(--space-lg); text-align: center; }
.sd-card .num { font-size: var(--fs-xl); font-weight: 700; }
.sd-card .num.ok { color: var(--color-success); }
.sd-card .num.bad { color: var(--color-danger); }
.sd-card .num.primary { color: var(--color-primary); }
.sd-card .label { font-size: var(--fs-xs); color: var(--text-secondary); margin-top: 2px; }
.ch-rate-row { margin-bottom: var(--space-sm); }
.ch-rate-head { display: flex; justify-content: space-between; font-size: var(--fs-sm); color: var(--text-secondary); margin-bottom: 4px; }
.trend-text { font-weight: 400; font-size: var(--fs-xs); color: var(--text-muted); }
.sparkline { display: flex; align-items: flex-end; gap: 4px; height: 60px; }
.spark-bar { flex: 1; border-radius: 3px 3px 0 0; min-height: 4px; }
.best-worst { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-sm); }
.bw-card { background: var(--surface-hover); border-radius: var(--radius-md); padding: var(--space-md); display: flex; flex-direction: column; gap: 4px; }
.bw-label { font-size: var(--fs-xs); color: var(--text-secondary); }
.bw-value { font-weight: 600; }
.bw-card.ok .bw-value { color: var(--color-success); }
.bw-card.bad .bw-value { color: var(--color-danger); }
.type-bar { display: flex; height: 28px; border-radius: var(--radius-md); overflow: hidden; margin-bottom: var(--space-sm); }
.type-seg { display: flex; align-items: center; justify-content: center; color: #fff; font-size: var(--fs-xs); font-weight: 500; }
.type-legend { display: flex; flex-wrap: wrap; gap: var(--space-md); }
.legend-item { display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-xs); color: var(--text-secondary); }
.legend-dot { width: 8px; height: 8px; border-radius: 50%; }

.qbank-toolbar { display: flex; align-items: center; gap: var(--space-md); margin-bottom: var(--space-md); flex-wrap: wrap; }
.qb-check { display: flex; align-items: center; gap: 6px; font-size: var(--fs-sm); color: var(--text-secondary); cursor: pointer; }
.qb-check input { accent-color: var(--color-primary); }
.qb-search { display: flex; align-items: center; gap: 6px; color: var(--text-muted); flex: 1; max-width: 320px; }
.qb-input { border: none; background: transparent; flex: 1; padding: 6px 8px; border-radius: var(--radius-sm); background: var(--surface-hover); font-size: var(--fs-sm); }
.qb-input:focus { outline: 2px solid var(--color-primary); outline-offset: -2px; }
.qb-header { display: flex; justify-content: space-between; align-items: center; }
.qb-meta { font-weight: 400; font-size: var(--fs-xs); color: var(--text-muted); }
.qb-item { padding: var(--space-sm) var(--space-md); border-radius: var(--radius-md); cursor: pointer; margin-bottom: 4px; border: 1px solid transparent; transition: border-color var(--transition-fast), background var(--transition-fast); }
.qb-item:hover { border-color: var(--color-primary); background: var(--surface-hover); }
.qb-item.correct { background: var(--color-success-light); }
.qb-item.wrong { background: var(--color-danger-light); }
.qb-q { font-size: var(--fs-sm); line-height: 1.6; }
.qb-detail { font-size: var(--fs-xs); color: var(--text-muted); margin-top: 2px; }
.qb-empty { color: var(--text-muted); font-size: var(--fs-sm); padding: var(--space-md); text-align: center; }

.ce-hint { color: var(--text-secondary); font-size: var(--fs-sm); margin-bottom: var(--space-sm); }
.ce-chapters { display: flex; flex-wrap: wrap; gap: var(--space-sm); margin-bottom: var(--space-sm); }
.ce-ch { display: flex; align-items: center; gap: 6px; padding: 8px 12px; background: var(--surface-hover); border-radius: var(--radius-md); cursor: pointer; font-size: var(--fs-sm); }
.ce-ch input { accent-color: var(--color-primary); }
.ce-ch-count { color: var(--text-muted); font-size: var(--fs-xs); }
.ce-total { font-size: var(--fs-xs); color: var(--text-muted); margin-top: 4px; }
.ce-empty { color: var(--text-muted); font-size: var(--fs-sm); text-align: center; padding: var(--space-sm); }
.cum-track { position: relative; height: 44px; margin: 8px 0; }
.cum-seg { position: absolute; top: 19px; height: 6px; }
.cum-track input[type="range"] { position: absolute; left: 0; top: 0; width: 100%; height: 44px; -webkit-appearance: none; background: transparent; pointer-events: none; }
.cum-track input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; width: 18px; height: 18px; border-radius: 50%; background: #fff; border: 2px solid var(--color-primary); pointer-events: auto; box-shadow: var(--shadow-sm); }
.cum-labels { display: flex; flex-direction: column; gap: 6px; margin-top: var(--space-sm); }
.cum-row { display: flex; align-items: center; gap: 8px; font-size: var(--fs-sm); }
.cum-dot { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }
.cum-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cum-input { width: 52px; padding: 4px 6px; border: 1px solid var(--border-light); border-radius: var(--radius-sm); text-align: center; }
.pct-input { width: 48px; padding: 3px 6px; border: 1px solid var(--border-light); border-radius: var(--radius-sm); text-align: center; font-size: var(--fs-sm); }
.strategy-labels { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; font-size: var(--fs-sm); color: var(--text-secondary); }
.dual-range-wrap { position: relative; height: 44px; margin: 4px 0; touch-action: none; }
.dual-track-bg { position: absolute; left: 0; right: 0; top: 19px; height: 6px; border-radius: 3px; background: var(--border-light); }
.dual-track-fill { position: absolute; top: 19px; height: 6px; }
.dual-track-fill.err { background: #EF4444; border-radius: 3px 0 0 3px; }
.dual-track-fill.review { background: #F59E0B; border-radius: 0 3px 3px 0; }
.dual-range-wrap input[type="range"] { position: absolute; left: 0; top: 0; width: 100%; height: 44px; -webkit-appearance: none; background: transparent; pointer-events: none; }
.dual-range-wrap input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; width: 18px; height: 18px; border-radius: 50%; background: #fff; border: 2px solid var(--color-primary); pointer-events: auto; }
.ce-actions { margin-top: var(--space-lg); }
.exam-item { display: flex; align-items: center; gap: var(--space-sm); padding: var(--space-sm) var(--space-md); border: 1px solid var(--border-light); border-radius: var(--radius-md); margin-bottom: 6px; cursor: pointer; transition: border-color var(--transition-fast); }
.exam-item:hover { border-color: var(--color-primary); }
.exam-main { flex: 1; min-width: 0; }
.exam-name { font-size: var(--fs-sm); font-weight: 500; }
.exam-meta { font-size: var(--fs-xs); color: var(--text-muted); }
.srs-hero { display: flex; align-items: center; gap: var(--space-lg); margin-bottom: var(--space-md); }
.srs-count { display: flex; flex-direction: column; }
.srs-num { font-size: var(--fs-2xl); font-weight: 700; color: var(--color-primary); }
.srs-label { font-size: var(--fs-xs); color: var(--text-secondary); }
.srs-item { display: flex; align-items: flex-start; gap: var(--space-sm); padding: var(--space-sm) var(--space-md); border: 1px solid var(--border-light); border-radius: var(--radius-md); margin-bottom: 6px; }
.srs-main { flex: 1; min-width: 0; }
.srs-q { font-size: var(--fs-sm); }
.srs-meta { font-size: var(--fs-xs); color: var(--text-muted); margin-top: 2px; }
.type-counts { display: flex; flex-wrap: wrap; gap: var(--space-sm); margin-bottom: var(--space-sm); }
.type-count-item { display: flex; flex-direction: column; gap: 4px; padding: 8px 12px; background: var(--surface-hover); border-radius: var(--radius-md); }
.type-count-item label { font-size: var(--fs-sm); color: var(--text-secondary); }
.num-picker { display: flex; align-items: center; gap: 2px; }
.num-btn { width: 30px; height: 32px; border-radius: var(--radius-sm); background: var(--surface-card); border: 1px solid var(--border-light); color: var(--text-secondary); font-size: var(--fs-md); display: flex; align-items: center; justify-content: center; }
.num-btn:hover { border-color: var(--color-primary); color: var(--color-primary); }
.num-input { width: 52px; height: 32px; text-align: center; border: 1px solid var(--border-light); border-radius: var(--radius-sm); background: var(--surface-card); font-size: var(--fs-base); }
.num-input:focus { border-color: var(--color-primary); box-shadow: var(--shadow-glow); outline: none; }
.qdetail { margin-bottom: var(--space-md); }
.qd-title { margin-bottom: var(--space-sm); }
.qd-q { line-height: 1.7; margin-bottom: var(--space-sm); }
.qd-options { display: flex; flex-direction: column; gap: 4px; margin-bottom: var(--space-sm); }
.qd-opt { padding: 8px 12px; background: var(--surface-hover); border-radius: var(--radius-md); font-size: var(--fs-sm); }
.qd-opt.ok { background: var(--color-success-light); color: var(--color-success); }
.qd-ans { font-size: var(--fs-sm); margin-bottom: var(--space-sm); }
.qd-ans.ok { color: var(--color-success); }
.qd-ans.bad { color: var(--color-danger); }
.qd-exp { background: var(--color-warning-light); border-radius: var(--radius-md); padding: var(--space-sm) var(--space-md); font-size: var(--fs-sm); line-height: 1.7; }
.qd-exp h4 { margin: 0 0 4px; }
@media (max-width: 768px) {
  .sd-grid { grid-template-columns: repeat(2, 1fr); }
  .best-worst { grid-template-columns: 1fr; }
}
</style>
