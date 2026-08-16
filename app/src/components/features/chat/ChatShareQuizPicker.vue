<!-- 对应 legacy chat.js：chatShowShareQuiz/_chatRenderDrillView/_chatRenderBreadcrumb（下钻选科目→章节→题目，加分享车） -->
<template>
  <Teleport to="body">
    <div class="dialog-overlay" @mousedown.self="store.closeSharePicker()">
      <div class="dialog-box chat-sub-dialog-box">
        <div class="picker-header">
          <h3 class="chat-sub-dialog-title">{{ title }}</h3>
          <button class="picker-close" @click="store.closeSharePicker()" aria-label="关闭">×</button>
        </div>
        <div class="picker-breadcrumb">
          <button v-if="drill.level !== 'subject'" class="picker-back" @click="drillBack()">← 返回</button>
          <span>{{ breadcrumb }}</span>
        </div>
        <input v-model="filter" class="chat-user-search-input" placeholder="搜索题目（可在任意层级搜索）..." />
        <div class="picker-list">
          <div v-for="item in viewItems" :key="item.key" class="chat-quiz-select-item" @click="onItemClick(item)">
            <div class="chat-quiz-select-info">
              <div class="chat-quiz-select-name">{{ item.name }}</div>
              <div class="chat-quiz-select-meta">{{ item.meta }}</div>
            </div>
            <span v-if="item.arrow" class="picker-arrow">▶</span>
          </div>
          <div v-if="viewItems.length === 0" class="chat-user-search-empty">{{ filter ? '无匹配的题目' : '暂无内容' }}</div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useChatStore } from '../../../stores/chat'
import { useDataStore } from '../../../stores/data'
import { useUiStore } from '../../../stores/ui'

const store = useChatStore()
const data = useDataStore()
const ui = useUiStore()

const tree = ref([])
const flat = ref([])
const drill = reactive({ level: 'subject', subjectId: null, chapterId: null, quizSetIdx: null })
const filter = ref('')

const typeMap = { single: '单选题', judge: '判断题', term: '名词解释', short: '简答题' }
const typeIcon = { single: '📋', judge: '⚖️', term: '📖', short: '✍️' }
const levelLabels = { subject: '选择科目', chapter: '选择章节', quizset: '选择轮次', question: '选择题目' }

// 构建科目→章节→轮次→题目 下钻树 + 扁平搜索列表（语义同 legacy chatShowShareQuiz）
function buildTree() {
  const t = []
  const f = []
  const subjects = data.state.subjects || {}
  const chapters = data.state.chapters || {}
  Object.keys(subjects).forEach((sid) => {
    const subj = subjects[sid]
    const treeSubj = { id: sid, name: subj.name, chapters: [] }
    ;(subj.chapterIds || []).forEach((cid) => {
      const ch = chapters[cid]
      if (!ch) return
      const treeCh = { id: cid, name: ch.name, quizSets: [] }
      ;(ch.quizSets || []).forEach((qs, qsIdx) => {
        if (!qs.questions || qs.questions.length === 0) return
        const treeQs = { name: '第' + (qsIdx + 1) + '轮', qsIdx, questions: [] }
        qs.questions.forEach((q, qi) => {
          const fi = f.length
          f.push({ question: q, qIndex: qi, path: subj.name + ' > ' + ch.name + ' > 第' + (qsIdx + 1) + '轮 > Q' + (qi + 1), sid, cid, qsIdx })
          treeQs.questions.push({ question: q, qIndex: qi, flatIdx: fi })
        })
        treeCh.quizSets.push(treeQs)
      })
      if ((!ch.quizSets || ch.quizSets.length === 0) && ch.questions && ch.questions.length > 0) {
        const treeQs = { name: '章节题目', qsIdx: -1, questions: [] }
        ch.questions.forEach((q, qi) => {
          const fi = f.length
          f.push({ question: q, qIndex: qi, path: subj.name + ' > ' + ch.name + ' > Q' + (qi + 1), sid, cid, qsIdx: -1 })
          treeQs.questions.push({ question: q, qIndex: qi, flatIdx: fi })
        })
        treeCh.quizSets.push(treeQs)
      }
      if (treeCh.quizSets.length > 0) treeSubj.chapters.push(treeCh)
    })
    if (treeSubj.chapters.length > 0) t.push(treeSubj)
  })
  tree.value = t
  flat.value = f
}

const title = computed(() => levelLabels[drill.level] || '选择题目')

const breadcrumb = computed(() => {
  if (drill.level === 'subject') return '📚 全部科目'
  const subj = tree.value.find((s) => s.id === drill.subjectId)
  let text = subj ? ('📚 ' + subj.name) : ''
  if (drill.level === 'chapter') return text + ' › 选择章节'
  const ch = subj && subj.chapters.find((c) => c.id === drill.chapterId)
  if (ch && (drill.level === 'quizset' || drill.level === 'question')) text += ' › 📖 ' + ch.name
  if (drill.level === 'quizset') return text + ' › 选择轮次'
  if (drill.level === 'question') {
    const qs = ch && ch.quizSets[drill.quizSetIdx]
    if (qs) text += ' › 📝 ' + qs.name
    return text + ' › 选择题目'
  }
  return text
})

const viewItems = computed(() => {
  const f = filter.value.trim().toLowerCase()
  if (f) {
    return flat.value
      .map((item, i) => ({ ...item, flatIdx: i }))
      .filter((item) => {
        const q = item.question
        const qt = (q.question || '').toLowerCase()
        return qt.indexOf(f) !== -1 || item.path.toLowerCase().indexOf(f) !== -1
      })
      .map((item) => {
        const q = item.question
        const icon = typeIcon[q.type] || '📝'
        return {
          key: 'q' + item.flatIdx,
          type: 'question',
          flatIdx: item.flatIdx,
          icon,
          name: icon + ' ' + (q.question || '').substring(0, 50),
          meta: (typeMap[q.type] || q.type) + ' · ' + item.path,
          arrow: false
        }
      })
  }
  if (drill.level === 'subject') {
    return tree.value.map((subj) => {
      let totalQ = 0
      subj.chapters.forEach((ch) => ch.quizSets.forEach((qs) => { totalQ += qs.questions.length }))
      return { key: 's' + subj.id, type: 'subject', subjectId: subj.id, icon: '📚', name: '📚 ' + subj.name, meta: subj.chapters.length + ' 个章节 · ' + totalQ + ' 题', arrow: true }
    })
  }
  if (drill.level === 'chapter') {
    const subj = tree.value.find((s) => s.id === drill.subjectId)
    if (!subj) return []
    return subj.chapters.map((ch) => {
      let totalQ = 0
      ch.quizSets.forEach((qs) => { totalQ += qs.questions.length })
      return { key: 'c' + ch.id, type: 'chapter', chapterId: ch.id, icon: '📖', name: '📖 ' + ch.name, meta: ch.quizSets.length + ' 个轮次 · ' + totalQ + ' 题', arrow: true }
    })
  }
  if (drill.level === 'quizset') {
    const subj = tree.value.find((s) => s.id === drill.subjectId)
    const ch = subj && subj.chapters.find((c) => c.id === drill.chapterId)
    if (!ch) return []
    return ch.quizSets.map((qs, qi) => ({
      key: 'qs' + qi, type: 'quizset', quizSetIdx: qi, icon: '📝', name: '📝 ' + qs.name, meta: qs.questions.length + ' 题', arrow: true
    }))
  }
  if (drill.level === 'question') {
    const subj = tree.value.find((s) => s.id === drill.subjectId)
    const ch = subj && subj.chapters.find((c) => c.id === drill.chapterId)
    const qs = ch && ch.quizSets[drill.quizSetIdx]
    if (!qs) return []
    return qs.questions.map((qw) => {
      const q = qw.question
      const icon = typeIcon[q.type] || '📝'
      return {
        key: 'q' + qw.flatIdx,
        type: 'question',
        flatIdx: qw.flatIdx,
        icon,
        name: icon + ' Q' + (qw.qIndex + 1) + '. ' + (q.question || '').substring(0, 60),
        meta: typeMap[q.type] || q.type,
        arrow: false
      }
    })
  }
  return []
})

function onItemClick(item) {
  if (item.type === 'subject') {
    drill.level = 'chapter'; drill.subjectId = item.subjectId; drill.chapterId = null; drill.quizSetIdx = null; filter.value = ''
  } else if (item.type === 'chapter') {
    drill.level = 'quizset'; drill.chapterId = item.chapterId; drill.quizSetIdx = null; filter.value = ''
  } else if (item.type === 'quizset') {
    drill.level = 'question'; drill.quizSetIdx = item.quizSetIdx; filter.value = ''
  } else if (item.type === 'question') {
    selectQuiz(item.flatIdx)
  }
}

function selectQuiz(flatIdx) {
  const item = flat.value[flatIdx]
  if (!item) return
  store.addToQuizCart({ question: item.question, path: item.path, flatIdx, qIndex: item.qIndex })
}

function drillBack() {
  if (drill.level === 'chapter') {
    drill.level = 'subject'; drill.subjectId = null; drill.chapterId = null; drill.quizSetIdx = null
  } else if (drill.level === 'quizset') {
    drill.level = 'chapter'; drill.chapterId = null; drill.quizSetIdx = null
  } else if (drill.level === 'question') {
    drill.level = 'quizset'; drill.quizSetIdx = null
  }
  filter.value = ''
}

onMounted(() => {
  buildTree()
  if (flat.value.length === 0) {
    ui.toast('暂无题目可分享，请先创建题目', 'info')
    store.closeSharePicker()
  }
})
</script>

<style scoped>
.chat-sub-dialog-box {
  max-width: 480px;
  max-height: 75vh;
  display: flex;
  flex-direction: column;
}
.picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.chat-sub-dialog-title { margin: 0; }
.picker-close {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: var(--text-muted);
  padding: 0 4px;
  line-height: 1;
}
.picker-close:hover { color: var(--text-primary); }
.picker-breadcrumb {
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 8px;
  min-height: 18px;
}
.picker-back {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  color: var(--color-primary);
  text-decoration: underline;
  margin-right: 6px;
  font-size: 11px;
  font-family: inherit;
}
.chat-user-search-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  font-size: var(--fs-sm);
  font-family: inherit;
  color: var(--text-primary);
  background: var(--surface-bg);
  box-sizing: border-box;
  outline: none;
  margin-bottom: 8px;
}
.chat-user-search-input:focus { border-color: var(--color-primary); box-shadow: var(--shadow-glow); }
.chat-user-search-input::placeholder { color: var(--text-muted); }
.picker-list { max-height: 320px; overflow-y: auto; }
.chat-quiz-select-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-light);
  cursor: pointer;
  transition: background var(--transition-fast);
}
.chat-quiz-select-item:hover { background: var(--surface-hover); }
.chat-quiz-select-info { flex: 1; min-width: 0; }
.chat-quiz-select-name { font-size: var(--fs-sm); font-weight: 500; color: var(--text-primary); }
.chat-quiz-select-meta { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
.picker-arrow { color: var(--text-muted); font-size: 16px; }
.chat-user-search-empty {
  text-align: center;
  padding: 20px;
  color: var(--text-muted);
  font-size: var(--fs-xs);
}
</style>
