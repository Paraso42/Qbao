<template>
  <section class="start-hero">
    <div class="hero-mark">Q</div>
    <h1 class="hero-title">Qbao</h1>
    <p class="hero-sub">全能互动做题引擎 — 按章节刷题 · AI 智能出题 · 间隔复习</p>
    <div class="hero-actions" v-if="!hasSubject">
      <button class="btn btn-primary" @click="createFirstSubject">＋ 新建科目</button>
    </div>
    <div class="stat-cards" v-else>
      <div class="stat-card">
        <div class="stat-num tabular-nums">{{ rate }}%</div>
        <div class="stat-label">章节正确率</div>
      </div>
      <div class="stat-card">
        <div class="stat-num tabular-nums">{{ count }}</div>
        <div class="stat-label">章节题量</div>
      </div>
      <div class="stat-card">
        <div class="stat-num tabular-nums">{{ wrong }}</div>
        <div class="stat-label">错题数</div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import { useDataStore } from '../stores/data'
import { useSubjectStore } from '../stores/subjects'

const data = useDataStore()
const subjects = useSubjectStore()

const hasSubject = computed(() => subjects.list.length > 0)
const ch = computed(() => data.getCh())

const count = computed(() => (ch.value && ch.value.questions ? ch.value.questions.length : 0))
const answered = computed(() => (ch.value && ch.value.userAnswers ? ch.value.userAnswers.filter((a) => a !== undefined && a !== null && a !== -1).length : 0))
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

function createFirstSubject() {
  subjects.create('我的科目')
}
</script>

<style scoped>
.start-hero { text-align: center; padding: 48px 20px; }
.hero-mark {
  width: 72px;
  height: 72px;
  margin: 0 auto 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 34px;
  font-weight: 700;
  color: #fff;
  border-radius: var(--radius-xl);
  background: var(--gradient-primary);
  box-shadow: var(--shadow-lg);
}
.hero-title { margin-bottom: var(--space-sm); }
.hero-sub { color: var(--text-secondary); margin-bottom: var(--space-xl); }
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
}
.stat-num { font-size: var(--fs-2xl); font-weight: 700; letter-spacing: -0.5px; }
.stat-label { font-size: var(--fs-sm); color: var(--text-secondary); margin-top: 4px; }
@media (max-width: 768px) {
  .stat-cards { grid-template-columns: 1fr; }
}
</style>
