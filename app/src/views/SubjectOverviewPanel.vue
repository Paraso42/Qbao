<template>
  <div class="sd-content">
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
        <div class="bw-card ok"><span class="bw-label">最佳章节</span><span class="bw-value">{{ best.name }} {{ best.rate }}%</span></div>
        <div class="bw-card bad"><span class="bw-label">待提升</span><span class="bw-value">{{ worst.name }} {{ worst.rate }}%</span></div>
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
</template>

<script setup>
// P2.2：科目总览面板（自 SubjectDashView.vue 拆出）— 纯状态派生展示
import { computed } from 'vue'
import { useDataStore } from '../stores/data'
import { isObjType, getCi } from '../services/utils'
import { chapterQuestionTotal } from '../services/chapterStats'

const data = useDataStore()

const typeNames = { single: '单选', judge: '判断', term: '名词解释', short: '简答' }
const typeColors = { single: '#4D6BFE', judge: '#F59E0B', term: '#8B5CF6', short: '#EF4444' }
const subj = computed(() => data.getSubj())

function rateColor(rate) {
  if (rate >= 70) return '#10B981'
  if (rate >= 40) return '#F59E0B'
  return '#EF4444'
}

const overview = computed(() => {
  const s = subj.value
  const out = { totalQs: 0, totalRounds: 0, histAnswered: 0, histCorrect: 0, histWrong: 0, rate: 0, chStats: [], rates: [], trendText: '' }
  if (!s) return out
  const typeDist = { single: 0, judge: 0, term: 0, short: 0 }
  s.chapterIds.forEach((cid) => {
    out.totalRounds += (data.state.history || []).filter((r) => r.chapterId === cid).length
    const ch = data.state.chapters[cid]
    if (!ch || !ch.questions) return
    out.totalQs += chapterQuestionTotal(ch)
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
    if (slope > 2) out.trendText = '实力提升中（每轮平均 +' + slope.toFixed(1) + '%）'
    else if (slope < -2) out.trendText = '实力下降中（每轮平均 ' + slope.toFixed(1) + '%）'
    else out.trendText = '实力稳定（每轮变化 ' + slope.toFixed(1) + '%）'
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
</script>

<style scoped>
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
</style>
