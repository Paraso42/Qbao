<!-- 答题历史：按章节查看每一轮（默认当前章节），不再一次性堆叠全部记录 -->
<template>
  <section>
    <div class="hs-head">
      <h1>答题历史</h1>
      <div class="hs-head-right">
        <span v-if="chapter" class="hs-current"><Icon name="book" :size="14" /> {{ subjectName }} · {{ chapter.name }}</span>
        <button class="btn btn-secondary btn-small" @click="ui.showScreen('start')"><Icon name="arrow-left" :size="14" /> 返回主页</button>
      </div>
    </div>

    <EmptyState v-if="allRecords.length === 0" icon="clock" title="暂无答题记录" hint="完成一轮答题后，历史记录会显示在这里" />

    <template v-else-if="chapter">
      <div class="hs-chapter">
        <div class="hs-chapter-info">
          <h2>{{ chapter.name }}</h2>
          <p class="hs-chapter-meta">{{ subjectName }} · 共 {{ records.length }} 轮<span v-if="records.length"> · 最近一轮 {{ records[0].date }}</span></p>
        </div>
      </div>

      <div v-for="item in records" :key="item.record.id" class="hs-session" :class="{ expanded: expanded.has(item.record.id) }">
        <div class="hs-session-head" @click="toggle(item.record.id)">
          <span class="hs-date"><Icon name="clock" :size="13" /> {{ item.record.date }}</span>
          <span class="hs-stats tabular-nums">
            <span class="hs-ok">答对 {{ item.record.correct || 0 }}</span>
            <span class="hs-bad">答错 {{ item.record.wrong || 0 }}</span>
            <span class="hs-rate">正确率 {{ item.record.rate || 0 }}%</span>
          </span>
          <span class="hs-caret"><Icon name="chevron-down" :size="14" :class="{ rotated: expanded.has(item.record.id) }" /></span>
        </div>
        <div v-if="expanded.has(item.record.id)" class="hs-session-body">
          <div class="hs-toolbar">
            <label class="hs-only-wrong"><input type="checkbox" v-model="wrongFilter[item.record.id]"> 只看错题</label>
            <input v-model="search[item.record.id]" class="hs-search" type="text" placeholder="搜索题目/解析...">
          </div>
          <div v-for="(q, i) in sessionQuestions(item.record).slice(0, qLimit[item.record.id] || 30)" :key="i" class="hs-q" :class="q.isCorrect === true ? 'correct' : (q.isCorrect === false ? 'wrong' : '')">
            <p class="hs-q-text"><span v-html="renderMarkdown(q.question)"></span></p>
            <p class="hs-q-meta">[{{ typeShort[q.type] || q.type }}] {{ q.tag || '' }} · 第{{ i + 1 }}题</p>
            <p v-if="q.explanation" class="hs-q-exp"><span v-html="renderMarkdown(q.explanation)"></span></p>
          </div>
          <button v-if="(qLimit[item.record.id] || 30) < sessionQuestions(item.record).length" class="hs-more" @click="qLimit[item.record.id] = (qLimit[item.record.id] || 30) + 30">
            显示更多（已显示 {{ qLimit[item.record.id] }} / {{ sessionQuestions(item.record).length }}）
          </button>
        </div>
      </div>
    </template>

    <div v-else class="card">
      <EmptyState icon="book" title="该章节暂无答题记录" hint="在上方选择其他章节查看" />
    </div>
  </section>
</template>

<script setup>
import { computed, reactive } from 'vue'
import { useDataStore } from '../stores/data'
import { useSubjectStore } from '../stores/subjects'
import { useUiStore } from '../stores/ui'
import { renderMarkdown } from '../services/utils'
import Icon from '../components/ui/Icon.vue'
import EmptyState from '../components/ui/EmptyState.vue'

const data = useDataStore()
const subjects = useSubjectStore()
const ui = useUiStore()

const typeShort = { single: '单选', judge: '判断', term: '名解', short: '简答' }
const expanded = reactive(new Set())
const wrongFilter = reactive({})
const search = reactive({})
const qLimit = reactive({})

const allRecords = computed(() => data.state.history || [])
// 直接锁定当前章节（章节内查看单章答题记录，不再提供跨章节切换栏）
const selectedChId = computed(() => data.state.currentChapterId || null)

const chapter = computed(() => (selectedChId.value ? data.state.chapters[selectedChId.value] || null : null))
const subjectName = computed(() => {
  if (!selectedChId.value) return ''
  for (const s of subjects.list) {
    if (s.chapterIds.includes(selectedChId.value)) return s.name
  }
  return ''
})
const records = computed(() => {
  if (!selectedChId.value) return []
  return allRecords.value
    .filter((r) => r.chapterId === selectedChId.value)
    .slice()
    .reverse()
    .map((record) => ({ record }))
})

function toggle(id) {
  if (expanded.has(id)) expanded.delete(id)
  else expanded.add(id)
}

function sessionQuestions(record) {
  if (!record.questions) return []
  const onlyWrong = wrongFilter[record.id]
  const kw = (search[record.id] || '').trim().toLowerCase()
  return record.questions.filter((q) => {
    if (onlyWrong && q.isCorrect !== false) return false
    if (kw) {
      const hay = ((q.question || '') + ' ' + (q.explanation || '')).toLowerCase()
      if (!hay.includes(kw)) return false
    }
    return true
  })
}
</script>

<style scoped>
.hs-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-md); flex-wrap: wrap; gap: var(--space-sm); }
.hs-head h1 { margin: 0; }
.hs-head-right { display: flex; align-items: center; gap: var(--space-sm); flex-wrap: wrap; }
.hs-current {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  background: var(--surface-panel);
  color: var(--text-secondary);
  font-size: var(--fs-sm);
}
.hs-chapter { margin-bottom: var(--space-md); }
.hs-chapter-info h2 { margin: 0; }
.hs-chapter-meta { color: var(--text-muted); font-size: var(--fs-xs); margin-top: 4px; }
.hs-session { border: 1px solid var(--border-light); border-radius: var(--radius-md); margin-bottom: var(--space-sm); overflow: hidden; background: var(--surface-card); }
.hs-session-head {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  cursor: pointer;
  transition: background var(--transition-fast);
  min-height: 44px;
}
.hs-session-head:hover { background: var(--surface-hover); }
.hs-date { flex: 1; font-size: var(--fs-sm); color: var(--text-secondary); }
.hs-stats { font-size: var(--fs-sm); display: inline-flex; gap: 10px; }
.hs-ok { color: var(--color-success); }
.hs-bad { color: var(--color-danger); }
.hs-rate { color: var(--text-secondary); }
.hs-caret { color: var(--text-muted); display: flex; transition: transform var(--transition-fast); }
.hs-caret .icon.rotated { transform: rotate(180deg); }
.hs-session-body { border-top: 1px solid var(--border-light); padding: var(--space-sm) var(--space-md) var(--space-md); background: var(--surface-panel); }
.hs-toolbar { display: flex; align-items: center; gap: var(--space-md); margin-bottom: var(--space-sm); flex-wrap: wrap; }
.hs-only-wrong { display: flex; align-items: center; gap: 6px; font-size: var(--fs-xs); color: var(--text-secondary); cursor: pointer; }
.hs-only-wrong input { accent-color: var(--color-primary); }
.hs-search { flex: 1; max-width: 260px; padding: 6px 10px; border: 1px solid var(--border-light); border-radius: var(--radius-md); background: var(--surface-card); font-size: var(--fs-xs); }
.hs-search:focus { border-color: var(--color-primary); outline: none; }
.hs-q { padding: var(--space-sm) var(--space-md); background: var(--surface-card); border: 1px solid var(--border-light); border-radius: var(--radius-md); margin-bottom: 6px; }
.hs-q.correct { border-color: var(--color-success-light); }
.hs-q.wrong { border-color: var(--color-danger-light); background: var(--color-danger-light); }
.hs-q-text { font-size: var(--fs-sm); line-height: 1.6; }
.hs-q-meta { font-size: var(--fs-xs); color: var(--text-muted); margin-top: 2px; }
.hs-q-exp { font-size: var(--fs-xs); color: var(--text-secondary); margin-top: 4px; line-height: 1.6; }
.hs-more {
  width: 100%;
  padding: 8px;
  font-size: var(--fs-xs);
  color: var(--color-primary);
  border-radius: var(--radius-sm);
  margin-top: 2px;
}
.hs-more:hover { background: var(--color-primary-light); }
@media (max-width: 768px) {
  .hs-stats { gap: 6px; }
}
</style>
