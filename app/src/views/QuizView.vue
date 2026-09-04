<!-- 答题弹窗（答题 + 报告，自 legacy quiz-engine/quiz-report 迁移） -->
<template>
  <Modal :open="quiz.session.modalOpen" wide fullscreen @close="close">
    <!-- 答题视图 -->
    <div v-if="quiz.session.view === 'quiz'" id="quiz-root" class="quiz-shell">
      <div class="quiz-header">
        <span class="quiz-ch-name">{{ setName }}</span>
        <span class="cap-chip" v-if="q">{{ typeMap[q.type] || q.type }}</span>
        <span class="quiz-header-spacer"></span>
      </div>

      <div v-if="!as || !q" class="quiz-body">
        <EmptyState icon="book" title="暂无题目" hint="导入题目或使用 AI 出题后即可开始答题" />
      </div>

      <div v-else class="quiz-body">
        <div class="quiz-question" :style="{ fontSize: quizFontSize + 'px' }">
          <strong>{{ idx + 1 }}. </strong><span v-html="questionHtml"></span>
        </div>

        <!-- 客观题选项 -->
        <div v-if="isObj" class="quiz-options">
          <div v-for="(opt, i) in q.options" :key="i" class="quiz-option"
            :class="optionClass(i)" @click="!hasAnswer && quiz.selectOption(i)">
            <span class="opt-letter">{{ letter(i) }}</span>
            <span class="opt-text" v-html="optionHtml(i)"></span>
          </div>
        </div>

        <!-- 主观题作答 -->
        <div v-else class="quiz-options">
          <textarea v-if="!hasAnswer" ref="subjInput" v-model="subjective" class="textarea subj-input" rows="4"
            placeholder="输入你的答案..." @keydown="onSubjKeydown"></textarea>
          <div v-else class="subj-done">
            <div class="subj-label">你的答案</div>
            <p class="subj-text">{{ currentAnswer }}</p>
          </div>
        </div>

        <!-- 参考答案 -->
        <div v-if="hasAnswer && q.explanation" class="explanation-box">
          <h4>参考答案</h4>
          <p v-html="renderMarkdown(q.explanation)"></p>
        </div>

        <!-- 导航点 + 图例 -->
        <div v-if="as.questions && as.questions.length > 1" class="quiz-legend">
          <span class="lg-item"><span class="lg-dot current"></span>当前</span>
          <span class="lg-item"><span class="lg-dot"></span>未答</span>
          <span class="lg-item"><span class="lg-dot ok"></span>答对</span>
          <span class="lg-item"><span class="lg-dot bad"></span>答错</span>
        </div>
        <div v-if="as.questions && as.questions.length > 1" class="quiz-nav">
          <span v-if="dotWindow[0] > 0" class="dots-ellipsis">…</span>
          <template v-for="(qq, i) in as.questions" :key="i">
            <button v-if="as.questions.length <= 40 || (i >= dotWindow[0] && i <= dotWindow[1])" class="dot"
              :aria-label="'跳转到第 ' + (i + 1) + ' 题'"
              :class="dotClass(i)" @click="quiz.goToQuestion(i)">{{ i + 1 }}</button>
          </template>
          <span v-if="dotWindow[1] < as.questions.length - 1" class="dots-ellipsis">…</span>
        </div>

        <!-- 操作栏 -->
        <div class="quiz-actions">
          <template v-if="!hasAnswer">
            <button v-if="isObj" class="btn btn-primary" @click="submit">提交答案</button>
            <button v-else class="btn btn-primary" @click="submit">提交答案</button>
            <button v-if="isObj" class="btn btn-danger" @click="quiz.markDontKnow">我不会</button>
          </template>
          <template v-else>
            <button v-if="idx > 0" class="btn btn-ghost" @click="quiz.goToQuestion(idx - 1)">上一题</button>
            <button v-if="idx < as.questions.length - 1" class="btn btn-primary" @click="quiz.nextQuestion">下一题</button>
            <button v-else class="btn btn-primary" @click="quiz.endExam">查看报告</button>
          </template>
          <button class="btn btn-ghost btn-small qa-share" @click="shareCurrent" title="分享当前题目给好友"><Icon name="share" :size="14" /> 分享</button>
          <button v-if="as.isExam" class="btn btn-danger" @click="quiz.endExam">结束</button>
        </div>
      </div>
    </div>

    <!-- 报告视图 -->
    <div v-else class="report-shell">
      <h3 class="rp-title">本轮报告</h3>
      <div v-if="as && as.questions.length" class="rp-content">
        <div class="report-grid">
          <div class="report-stat correct"><div class="num">{{ stats.objCorrect + stats.subjCount }}</div><div class="label">正确</div></div>
          <div class="report-stat wrong"><div class="num">{{ stats.wrongCount }}</div><div class="label">错误</div></div>
          <div class="report-stat rate"><div class="num">{{ rate }}%</div><div class="label">正确率</div></div>
          <div class="report-stat"><div class="num">{{ stats.answered }}/{{ stats.total }}</div><div class="label">进度</div></div>
        </div>

        <div v-if="wrongTags.length > 0" class="wrong-tags">
          <span class="wt-label">错题标签</span>
          <span v-for="t in wrongTags" :key="t" class="wt-chip">{{ t }}</span>
        </div>

        <div class="rp-toolbar">
          <h4>逐题回顾</h4>
          <label class="only-wrong"><input type="checkbox" v-model="wrongOnly"> 只看错题</label>
        </div>

        <div v-for="(qq, i) in reviewList" :key="i" class="review-item" :class="reviewClass(qq)">
          <div class="rv-q">
            <span class="rv-icon" :class="reviewIconClass(qq)" aria-hidden="true"></span>
            <span class="rv-type">{{ typeMap[qq.q.type] || qq.q.type }}</span>
            <span class="rv-text">第{{ qq.index + 1 }}题：<span v-html="renderMarkdown(qq.q.question)"></span></span>
          </div>
          <div v-if="qq.ans !== undefined" class="rv-detail">
            <template v-if="isObjQ(qq.q)">
              <span class="rv-ans" :class="qq.ci ? 'ok' : 'bad'">你的答案：{{ letter(qq.ans) }}. <span v-html="renderMarkdown(String(qq.q.options[qq.ans] ?? ''))"></span></span>
              <span class="rv-ans ok">标准答案：{{ letter(qq.q.answer) }}. <span v-html="renderMarkdown(String(qq.q.options[qq.q.answer] ?? ''))"></span></span>
            </template>
            <template v-else>
              <span class="rv-subj">你的答案：{{ qq.ans }}</span>
            </template>
          </div>
          <div v-if="qq.q.explanation" class="rv-exp"><span v-html="renderMarkdown(qq.q.explanation)"></span></div>
        </div>
      </div>
      <EmptyState v-else icon="chart" title="暂无数据" />

      <div class="dialog-actions rp-actions">
        <button class="btn btn-primary btn-small" @click="shareSet"><Icon name="share" :size="14" /> 分享给好友</button>
        <button class="btn btn-secondary" @click="close">关闭</button>
      </div>
    </div>
  </Modal>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useQuizStore } from '../stores/quiz'
import { useDataStore } from '../stores/data'
import { useUiStore } from '../stores/ui'
import { useUserStore } from '../stores/user'
import { renderMarkdown, isObjType, getCi } from '../services/utils'
import Modal from '../components/ui/Modal.vue'
import Icon from '../components/ui/Icon.vue'
import EmptyState from '../components/ui/EmptyState.vue'

const quiz = useQuizStore()
const data = useDataStore()
const ui = useUiStore()
const user = useUserStore()

const subjective = ref('')
const subjInput = ref(null)
const wrongOnly = ref(false)
const typeMap = { single: '单选题', judge: '判断题', term: '名词解释', short: '简答题' }

const as = computed(() => quiz.activeSet)
const q = computed(() => quiz.currentQuestion)
const idx = computed(() => {
  const s = as.value
  if (!s) return 0
  return Math.max(0, Math.min(s.currentIdx, ((s.questions && s.questions.length) || 1) - 1))
})
const hasAnswer = computed(() => quiz.hasAnswer)
const currentAnswer = computed(() => quiz.currentAnswer)
const isObj = computed(() => q.value && isObjType(q.value.type))
const setName = computed(() => (as.value ? as.value.setName : ''))
const quizFontSize = computed(() => (data.state.settings && data.state.settings.quizFontSize) || 17)
const stats = computed(() => quiz.stats)
const rate = computed(() => (stats.value.objTotal > 0 ? Math.round((stats.value.objCorrect / stats.value.objTotal) * 100) : 0))

const questionHtml = computed(() => (q.value ? renderMarkdown(q.value.question) : ''))
function optionHtml(i) { return q.value && q.value.options ? renderMarkdown(q.value.options[i]) : '' }
function letter(i) { return String.fromCharCode(65 + i) }

function optionClass(i) {
  const cls = []
  if (hasAnswer.value) {
    if (i === currentAnswer.value) cls.push(currentAnswer.value === q.value.answer ? 'correct' : 'wrong')
    if (i === q.value.answer) cls.push('correct')
    cls.push('disabled')
  } else if (currentAnswer.value === i) {
    cls.push('selected')
  }
  return cls
}

const wrongTags = computed(() => {
  const tags = new Set()
  if (!as.value || !as.value.questions) return []
  as.value.questions.forEach((qq, i) => {
    const ans = as.value.userAnswers && as.value.userAnswers[i]
    if (isObjType(qq.type) && ans !== undefined && getCi(qq, ans) === false && qq.tag) tags.add(qq.tag)
  })
  return [...tags]
})

const reviewList = computed(() => {
  if (!as.value || !as.value.questions) return []
  return as.value.questions.map((qq, i) => {
    const ans = as.value.userAnswers && as.value.userAnswers[i]
    const ci = ans !== undefined && ans !== -1 && ans !== null ? getCi(qq, ans) : null
    return { q: qq, index: i, ans, ci }
  }).filter((item) => {
    if (wrongOnly.value) return item.ci === false
    return true
  })
})
function reviewClass(item) {
  if (item.ans === undefined || item.ans === -1 || item.ans === null) return ''
  return item.ci === false ? 'is-wrong' : (item.ci === true ? 'is-correct' : '')
}
function reviewIconClass(item) {
  if (item.ans === undefined || item.ans === -1 || item.ans === null) return 'pending'
  if (item.ci === true) return 'ok'
  if (item.ci === false) return 'bad'
  return 'subj'
}
function isObjQ(qq) { return isObjType(qq.type) }

// 大题量时题号点开窗渲染，避免一次性生成数百个 DOM 节点
const dotWindow = computed(() => {
  const len = (as.value && as.value.questions) ? as.value.questions.length : 0
  if (len <= 40) return [0, len - 1]
  const cur = idx.value
  const half = 12
  const start = Math.max(0, Math.min(cur - half, len - 25))
  return [start, start + 24]
})

function dotClass(i) {
  const cls = []
  if (i === idx.value) cls.push('current')
  const ua = as.value.userAnswers
  const qs = as.value.questions
  if (ua && qs && ua[i] !== undefined && ua[i] !== null) {
    cls.push(getCi(qs[i], ua[i]) ? 'answered' : 'wrong')
  }
  return cls
}

function submit() {
  if (!isObj.value && !subjective.value.trim()) {
    quiz.submitAnswer('')
    return
  }
  quiz.submitAnswer(subjective.value)
  if (isObj.value) subjective.value = ''
}

function onSubjKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    submit()
  }
}

function close() {
  quiz.closeQuiz()
  wrongOnly.value = false
}

// —— 分享（同 legacy shareCurrentQuestion / chatShareCurrentQuizSet） ——
function shareCurrent() {
  const s = as.value
  const qq = q.value
  if (!s || !qq) { ui.toast('当前没有题目', 'err'); return }
  if (!user.isOnline) { ui.toast('请先登录', 'err'); return }
  const ch = data.getCh()
  ui.openQuizShare({
    questions: [qq],
    setName: s.setName || '',
    chapterName: ch ? ch.name : '',
    fromUserName: user.user.displayName || user.user.username,
    fromUserId: user.userId
  })
}
function shareSet() {
  const s = as.value
  if (!s || !s.questions || s.questions.length === 0) { ui.toast('暂无题目可分享', 'err'); return }
  if (!user.isOnline) { ui.toast('请先登录', 'err'); return }
  ui.openQuizShare({
    questions: s.questions,
    setName: s.setName || '题目分享',
    chapterName: '',
    fromUserName: user.user.displayName || user.user.username,
    fromUserId: user.userId
  })
}

watch(() => quiz.session.view, (v) => {
  if (v === 'quiz') { subjective.value = ''; wrongOnly.value = false }
})

// 修复：主观题答案复用 — 切换题目时清空输入框，防止上一题答案带入下一题
// （已答题由 hasAnswer 分支显示历史答案，不受影响）
watch(idx, () => { subjective.value = '' })

// 主观题自动聚焦：进入名词解释/简答题且未作答时，光标自动落入输入框并闪烁，
// 用户可直接全键盘操作（答题→回车提交→下一题自动聚焦），省去一次鼠标点击
function focusSubjectiveInput() {
  const qq = q.value
  if (!qq || !qq.type || (qq.type !== 'term' && qq.type !== 'short')) return
  if (hasAnswer.value) return
  requestAnimationFrame(() => {
    try { if (subjInput.value && typeof subjInput.value.focus === 'function') subjInput.value.focus() } catch (e) { /* noop */ }
  })
}
watch(
  [() => quiz.session.modalOpen, () => quiz.session.view, idx, hasAnswer],
  () => {
    if (quiz.session.modalOpen && quiz.session.view === 'quiz') focusSubjectiveInput()
  }
)

// 键盘快捷键（同 legacy setupQuizKeyboard）
function onKeydown(e) {
  if (!quiz.session.modalOpen || quiz.session.view !== 'quiz') return
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return
  const s = as.value
  if (!s) return
  const qq = q.value
  if (!qq) return
  const has = hasAnswer.value
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    e.preventDefault()
    if (has && idx.value < s.questions.length - 1) quiz.nextQuestion()
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    e.preventDefault()
    if (idx.value > 0) quiz.goToQuestion(idx.value - 1)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (!has) submit()
    else if (idx.value >= s.questions.length - 1) quiz.endExam()
    else quiz.nextQuestion()
  }
  if (!has && isObj.value) {
    const numKeys = { '1': 0, '2': 1, '3': 2, '4': 3 }
    const letterKeys = { 'a': 0, 'b': 1, 'c': 2, 'd': 3 }
    const k = e.key.toLowerCase()
    if (e.key in numKeys && numKeys[e.key] < (qq.options ? qq.options.length : 0)) {
      e.preventDefault()
      quiz.selectOption(numKeys[e.key])
    } else if (k in letterKeys && letterKeys[k] < (qq.options ? qq.options.length : 0)) {
      e.preventDefault()
      quiz.selectOption(letterKeys[k])
    }
  }
}
watch(() => quiz.session.modalOpen, (open) => {
  if (open) window.addEventListener('keydown', onKeydown)
  else window.removeEventListener('keydown', onKeydown)
})
</script>

<style scoped>
.quiz-shell { display: flex; flex-direction: column; min-height: 60vh; }
.quiz-header { display: flex; align-items: center; gap: var(--space-sm); margin-bottom: var(--space-md); }
.quiz-ch-name { font-size: var(--fs-md); font-weight: 600; }
.quiz-header-spacer { flex: 1; }
.quiz-body { flex: 1; display: flex; flex-direction: column; }
.quiz-question { font-size: var(--quiz-font-size, 17px); line-height: 1.7; margin-bottom: var(--space-lg); }
.quiz-options { display: flex; flex-direction: column; gap: var(--space-sm); margin-bottom: var(--space-lg); }
.quiz-option {
  display: flex;
  align-items: flex-start;
  gap: var(--space-sm);
  padding: 12px 14px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: border-color var(--transition-fast), background var(--transition-fast), box-shadow var(--transition-fast);
  font-size: 15px;
  line-height: 1.6;
}
.quiz-option:hover:not(.disabled) { border-color: var(--color-primary); box-shadow: var(--shadow-sm); }
.quiz-option.selected { border-color: var(--color-primary); background: var(--color-primary-light); }
.quiz-option.correct { border-color: var(--color-success); background: var(--color-success-light); box-shadow: inset 0 0 0 1px var(--color-success); }
.quiz-option.wrong { border-color: var(--color-danger); background: var(--color-danger-light); box-shadow: inset 0 0 0 1px var(--color-danger); }
.quiz-option.disabled { cursor: default; }
.opt-letter {
  width: 24px; height: 24px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border-radius: var(--radius-full);
  background: var(--surface-hover);
  font-size: var(--fs-sm); font-weight: 600;
}
.quiz-option.selected .opt-letter, .quiz-option.correct .opt-letter { background: var(--color-primary); color: #fff; }
.quiz-option.wrong .opt-letter { background: var(--color-danger); color: #fff; }
.opt-text { flex: 1; }
.subj-input { min-height: 90px; }
.subj-done { padding: var(--space-md); background: var(--surface-hover); border-radius: var(--radius-md); }
.subj-label { font-size: var(--fs-xs); color: var(--text-muted); margin-bottom: 4px; }
.subj-text { white-space: pre-wrap; line-height: 1.6; }
.explanation-box {
  margin: var(--space-md) 0;
  padding: var(--space-md) var(--space-lg);
  background: var(--color-primary-light);
  border-radius: var(--radius-md);
  border-left: 3px solid var(--color-primary);
}
.explanation-box h4 { margin: 0 0 4px; }
.explanation-box p { font-size: var(--fs-base); line-height: 1.7; }
.quiz-legend { display: flex; flex-wrap: wrap; gap: 12px; margin: var(--space-md) 0 var(--space-xs); font-size: 11px; color: var(--text-muted); }
.lg-item { display: inline-flex; align-items: center; gap: 5px; }
.lg-dot { width: 12px; height: 12px; border-radius: 4px; border: 1px solid var(--border-strong); background: var(--surface-card); }
.lg-dot.current { background: var(--color-primary); border-color: var(--color-primary); }
.lg-dot.ok { background: var(--color-success); border-color: var(--color-success); }
.lg-dot.bad { background: var(--color-danger); border-color: var(--color-danger); }
.quiz-nav { display: flex; flex-wrap: wrap; gap: 6px; margin: var(--space-sm) 0 var(--space-md); align-items: center; }
.dots-ellipsis { color: var(--text-muted); font-size: var(--fs-xs); padding: 0 2px; }
.dot {
  width: 30px; height: 30px;
  border-radius: var(--radius-full);
  border: 1px solid var(--border-light);
  background: var(--surface-card);
  font-size: var(--fs-xs);
  color: var(--text-secondary);
  transition: all var(--transition-fast);
}
.dot:hover { border-color: var(--color-primary); }
.dot.current { background: var(--color-primary); border-color: var(--color-primary); color: #fff; font-weight: 600; }
.dot.answered { border-color: var(--color-success); color: var(--color-success); }
.dot.wrong { border-color: var(--color-danger); color: var(--color-danger); }
.quiz-actions { display: flex; gap: var(--space-sm); flex-wrap: wrap; margin-top: var(--space-lg); }

.report-shell { display: flex; flex-direction: column; }
.rp-title { margin-bottom: var(--space-md); }
.rp-content { flex: 1; }
.report-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-sm); margin-bottom: var(--space-md); }
.report-stat { background: var(--surface-hover); border-radius: var(--radius-md); padding: var(--space-md); text-align: center; }
.report-stat .num { font-size: var(--fs-xl); font-weight: 700; }
.report-stat .label { font-size: var(--fs-xs); color: var(--text-secondary); margin-top: 2px; }
.report-stat.correct .num { color: var(--color-success); }
.report-stat.wrong .num { color: var(--color-danger); }
.report-stat.rate .num { color: var(--color-primary); }
.wrong-tags { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: var(--space-md); }
.wt-label { font-size: var(--fs-sm); color: var(--text-secondary); }
.wt-chip { background: var(--color-warning-light); color: var(--color-warning); padding: 2px 10px; border-radius: var(--radius-full); font-size: var(--fs-xs); }
.rp-toolbar { display: flex; align-items: center; justify-content: space-between; margin: var(--space-md) 0 var(--space-sm); }
.rp-toolbar h4 { margin: 0; }
.only-wrong { display: flex; align-items: center; gap: 6px; font-size: var(--fs-sm); color: var(--text-secondary); cursor: pointer; }
.only-wrong input { accent-color: var(--color-primary); width: 15px; height: 15px; }
.review-item { border: 1px solid var(--border-light); border-radius: var(--radius-md); padding: var(--space-md); margin-bottom: var(--space-sm); }
.review-item.is-wrong { border-color: var(--color-danger-light); background: var(--color-danger-light); }
.review-item.is-correct { border-color: var(--color-success-light); background: var(--color-success-light); }
.rv-q { display: flex; align-items: flex-start; gap: 6px; font-size: var(--fs-base); line-height: 1.6; }
.rv-icon {
  flex-shrink: 0;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  margin-top: 7px;
  background: var(--text-faint);
}
.rv-icon.ok { background: var(--color-success); }
.rv-icon.bad { background: var(--color-danger); }
.rv-icon.subj { background: var(--color-primary); }
.rv-type { flex-shrink: 0; font-size: var(--fs-xs); background: var(--surface-hover); padding: 1px 8px; border-radius: var(--radius-sm); color: var(--text-secondary); }
.rv-detail { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; font-size: var(--fs-sm); }
.rv-ans.ok { color: var(--color-success); }
.rv-ans.bad { color: var(--color-danger); }
.rv-subj { color: var(--text-secondary); }
.rv-exp { margin-top: 6px; font-size: var(--fs-sm); color: var(--text-secondary); line-height: 1.6; }
.rp-actions { justify-content: flex-end; }
@media (max-width: 768px) {
  .report-grid { grid-template-columns: repeat(2, 1fr); }
  .quiz-actions .btn { flex: 1; }
.quiz-actions .qa-share { flex: 0 0 auto; margin-left: auto; align-self: center; }
  .quiz-legend { font-size: 12px; }
  .lg-dot { width: 14px; height: 14px; }
}
</style>