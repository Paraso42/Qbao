<!-- 全部答题历史（自 legacy history.js 迁移，DeepSeek 风格） -->
<template>
  <section>
    <div class="hs-head">
      <h1>全部答题历史</h1>
      <button class="btn btn-secondary btn-small" @click="ui.showScreen('start')">← 返回</button>
    </div>

    <EmptyState v-if="groups.length === 0" icon="clock" title="暂无答题记录" hint="完成一轮答题后，历史记录会显示在这里" />

    <div v-for="g in groups" :key="g.chId" class="card hs-group">
      <h3 class="hs-ch">{{ g.name }} <span class="hs-count tabular-nums">{{ g.records.length }} 次</span></h3>
      <div v-for="item in g.records" :key="item.record.id" class="hs-session" :class="{ expanded: expanded.has(item.record.id) }">
        <div class="hs-session-head" @click="toggle(item.record.id)">
          <span class="hs-date">🕐 {{ item.record.date }}</span>
          <span class="hs-stats tabular-nums">✅ {{ item.record.correct || 0 }} / ❌ {{ item.record.wrong || 0 }} / 📊 {{ item.record.rate || 0 }}%</span>
          <span class="hs-caret"><Icon name="chevron-down" :size="14" :class="{ rotated: expanded.has(item.record.id) }" /></span>
        </div>
        <div v-if="expanded.has(item.record.id)" class="hs-session-body">
          <div class="hs-toolbar">
            <label class="hs-only-wrong"><input type="checkbox" v-model="wrongFilter[item.record.id]"> 只看错题</label>
            <input v-model="search[item.record.id]" class="hs-search" type="text" placeholder="搜索题目/解析...">
          </div>
          <div v-for="(q, i) in sessionQuestions(item.record)" :key="i" class="hs-q" :class="q.isCorrect === true ? 'correct' : (q.isCorrect === false ? 'wrong' : '')">
            <p class="hs-q-text"><span v-html="renderMarkdown(q.question)"></span></p>
            <p class="hs-q-meta">[{{ typeShort[q.type] || q.type }}] {{ q.tag || '' }} · 第{{ i + 1 }}题</p>
            <p v-if="q.explanation" class="hs-q-exp"><span v-html="renderMarkdown(q.explanation)"></span></p>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { useDataStore } from '../stores/data'
import { useUiStore } from '../stores/ui'
import { renderMarkdown } from '../services/utils'
import Icon from '../components/ui/Icon.vue'
import EmptyState from '../components/ui/EmptyState.vue'

const data = useDataStore()
const ui = useUiStore()

const typeShort = { single: '单选', judge: '判断', term: '名解', short: '简答' }
const expanded = reactive(new Set())
const wrongFilter = reactive({})
const search = reactive({})

const groups = computed(() => {
  const history = data.state.history || []
  const map = {}
  history.forEach((r) => {
    if (!map[r.chapterId]) map[r.chapterId] = { chId: r.chapterId, name: r.chapterName, records: [] }
    map[r.chapterId].records.push({ record: r })
  })
  return Object.values(map)
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
.hs-ch { display: flex; align-items: center; justify-content: space-between; }
.hs-count { font-weight: 400; font-size: var(--fs-xs); color: var(--text-muted); }
.hs-session { border: 1px solid var(--border-light); border-radius: var(--radius-md); margin-bottom: var(--space-sm); overflow: hidden; }
.hs-session-head {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  cursor: pointer;
  transition: background var(--transition-fast);
}
.hs-session-head:hover { background: var(--surface-hover); }
.hs-date { flex: 1; font-size: var(--fs-sm); color: var(--text-secondary); }
.hs-stats { font-size: var(--fs-sm); }
.hs-caret { color: var(--text-muted); display: flex; transition: transform var(--transition-fast); }
.hs-caret .icon.rotated { transform: rotate(180deg); }
.hs-session-body { border-top: 1px solid var(--border-light); padding: var(--space-sm) var(--space-md) var(--space-md); background: var(--surface-hover); }
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
</style>
