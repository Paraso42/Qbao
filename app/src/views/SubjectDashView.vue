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

    <!-- 总览（P2.2 拆分：SubjectOverviewPanel） -->
    <SubjectOverviewPanel v-if="tab === 'overview'" />
    <!-- 题库 -->
    <div v-else-if="tab === 'questionbank'" class="sd-content">
      <div class="qbank-toolbar">
        <label class="qb-check"><input type="checkbox" v-model="qbOnlyWrong"> 仅显示错题</label>
        <div class="qb-search"><Icon name="search" :size="14" /><input v-model="qbKeyword" class="qb-input" type="text" placeholder="搜索题目/标签..."></div>
        <template v-if="qbSelectMode">
          <span class="qb-sel-count">已选 {{ qbSelected.size }} 题</span>
          <select v-model="qbMoveTarget" class="select" style="max-width: 180px">
            <option value="">移动到章节…</option>
            <option v-for="m in qbMoveChapters" :key="m.cid" :value="m.cid">{{ m.name }}</option>
          </select>
          <button class="btn btn-secondary btn-small" @click="qbBulkTag"><Icon name="tag" :size="12" /> 设标签</button>
          <button class="btn btn-danger btn-small" @click="qbBulkDelete"><Icon name="trash" :size="12" /> 删除</button>
          <button class="btn btn-ghost btn-small" @click="qbExitSelect">退出</button>
        </template>
        <button v-else class="btn btn-ghost btn-small" @click="qbEnterSelect"><Icon name="check" :size="13" /> 批量</button>
        <div class="qb-tool-actions">
          <button class="btn btn-secondary btn-small" @click="ui.openImport()"><Icon name="upload" :size="13" /> 导入</button>
          <button class="btn btn-secondary btn-small" @click="exportChapter"><Icon name="download" :size="13" /> 导出</button>
        </div>
      </div>
      <div v-for="group in qbankGroups" :key="group.cid" class="card qb-group">
        <h4 class="qb-header" role="button" @click="toggleQbGroup(group.cid)">
          <span class="qb-caret"><Icon name="chevron-down" :size="13" :class="{ rotated: !openQbGroups.has(group.cid) }" /></span>
          {{ group.chName }}
          <span class="qb-meta">{{ group.ch.questions ? group.ch.questions.length : 0 }} 题 · {{ group.rounds }} 次答题</span>
        </h4>
        <template v-if="openQbGroups.has(group.cid)">
          <div v-if="group.items.length === 0" class="qb-empty">无匹配题目</div>
          <div v-if="qbSelectMode" class="qb-sel-box" :class="{ on: qbSelected.has(item.key) }" @click.stop="qbToggleSelect(item.key)"><Icon :name="qbSelected.has(item.key) ? 'check' : 'square'" :size="13" /></div>          <div v-for="item in shownQbItems(group)" :key="item.key" class="qb-item" :class="item.ci === true ? 'correct' : (item.ci === false ? 'wrong' : '')" @click="openDetail(item)">
            <span class="qb-icon" :class="qbIconClass(item.ci)"></span>
            <div class="qb-text">
              <p class="qb-q">[{{ typeShort[item.q.type] || item.q.type }}] {{ item.q.tag || '' }}：{{ shortText(item.q.question, 60) }}</p>
              <p v-if="item.q.explanation" class="qb-detail">{{ shortText(item.q.explanation, 80) }}</p>
            </div>
          </div>
          <button v-if="group.items.length > (qbLimits[group.cid] || 50)" class="qb-more" @click="qbLimits[group.cid] = (qbLimits[group.cid] || 50) + 50">
            显示更多（已显示 {{ qbLimits[group.cid] || 50 }} / {{ group.items.length }}）
          </button>
        </template>
      </div>
    </div>

    <!-- 错题本（P3.1） -->
    <div v-else-if="tab === 'wrongbook'" class="sd-content">
      <div class="qbank-toolbar">
        <select v-model="wbFilter" class="select" style="max-width: 240px">
          <option value="">全部章节</option>
          <option v-for="wbg in wbChapters" :key="wbg.cid" :value="wbg.cid">{{ wbg.name }}（{{ wbg.wrongCount }} 错）</option>
        </select>
        <span class="qb-meta">共 {{ wbItems.length }} 道错题{{ wbFilter ? '（当前章节）' : '' }}</span>
      </div>
      <div v-if="wbItems.length === 0" class="qb-empty">暂无错题 —— 做过答错的题目会出现在这里，可一键 AI 讲解</div>
      <div v-for="item in wbItems" :key="item.key" class="card qb-group">
        <div class="wb-item">
          <div class="wb-qline">
            <span class="wb-type">[{{ typeShort[item.q.type] || item.q.type }}]</span>
            <span class="wb-q">{{ item.q.question }}</span>
            <span v-if="item.q.tag" class="pill wb-tag">{{ item.q.tag }}</span>
          </div>
          <div class="wb-answers">
            <span class="wb-ans wrong">我的答案：{{ answerText(item.q, item.userAnswer) }}</span>
            <span class="wb-ans right">标准答案：{{ answerText(item.q, item.q.answer) }}</span>
            <span class="wb-date">{{ item.roundDate }}</span>
          </div>
          <div class="wb-actions">
            <button class="btn btn-primary btn-small" :disabled="wbLoading[item.key]" @click="askExplain(item)">
              <Icon name="sparkle" :size="12" /> {{ wbLoading[item.key] ? '讲解中…' : (wbCache(item) ? '重新讲解' : 'AI 讲解') }}</button>
          </div>
          <div v-if="wbOpen[item.key]" class="wb-explanation">
            <div class="wb-exp-head">AI 讲解 <span v-if="wbCache(item)" class="wb-exp-meta">{{ (wbCache(item).model || '') }} · {{ fmtWhen(wbCache(item).at) }}</span></div>
            <div class="markdown-body" v-html="renderMarkdown(wbCache(item) ? wbCache(item).explanation : '')"></div>
          </div>
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
          <template v-for="cid in (subj ? subj.chapterIds : [])" :key="cid">
            <label v-if="data.state.chapters[cid]" class="ce-ch">
              <input type="checkbox" :value="cid" v-model="checkedCids" @change="resetWeights">
              <span class="ce-ch-name">{{ data.state.chapters[cid].name }}</span>
              <span class="ce-ch-count tabular-nums">{{ data.state.chapters[cid].questions ? data.state.chapters[cid].questions.length : 0 }} 题</span>
            </label>
          </template>
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
          <span><i class="pct-dot err"></i>针对错题 <input v-model.number="examErrPct" class="pct-input" type="number" min="0" max="100">%</span>
          <span><i class="pct-dot review"></i>滚动复习 {{ 100 - examErrPct }}%</span>
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
          <span class="exam-icon"><Icon name="file" :size="15" /></span>
          <div class="exam-main">
            <div class="exam-name">{{ ex.name }}</div>
            <div class="exam-meta">{{ ex.questions.length }} 题 · {{ new Date(ex.createdAt).toLocaleString('zh-CN') }}</div>
          </div>
          <button class="btn btn-primary btn-small" @click.stop="quiz.startExam(ex.id)">开始答题</button>
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
          <span class="srs-icon"><Icon name="clock" :size="15" /></span>
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
import { computed, reactive, ref, watch } from 'vue'
import { useDataStore } from '../stores/data'
import { useSubjectStore } from '../stores/subjects'
import { useUiStore } from '../stores/ui'
import { downloadTextFile, exportQuestionsJson } from '../services/importExport'
import { useQuizStore } from '../stores/quiz'
import { useAiStore } from '../stores/ai'
import { isObjType, getCi } from '../services/utils'
import { getQuestionId } from '../services/questions'
import { getSrsDueQuestions } from '../services/srs'
import { composeSubjExam, getExamSettings } from '../services/exam'
import { renderMarkdown } from '../services/utils'
import Icon from '../components/ui/Icon.vue'
import Modal from '../components/ui/Modal.vue'
import SubjectOverviewPanel from './SubjectOverviewPanel.vue'

const data = useDataStore()
const subjects = useSubjectStore()
const ui = useUiStore()
const quiz = useQuizStore()
const ai = useAiStore()

// —— P3.1 错题本 ——
const wbFilter = ref('')
const wbOpen = reactive({})
const wbLoading = reactive({})

// 本科目错题（history 中判错的题目，含章节过滤）
const wbChapterMeta = computed(() => {
  const s = subj.value
  if (!s) return []
  return s.chapterIds.map((cid) => ({ cid, name: (data.state.chapters[cid] || {}).name || cid }))
})
const wbChapters = computed(() => {
  const counts = {}
  wbItems.value.forEach((it) => { counts[it.cid] = (counts[it.cid] || 0) + 1 })
  return wbChapterMeta.value.filter((m) => counts[m.cid]).map((m) => ({ ...m, wrongCount: counts[m.cid] || 0 }))
})
const wbItems = computed(() => {
  const s = subj.value
  if (!s) return []
  const out = []
  ;(data.state.history || []).forEach((r) => {
    if (!s.chapterIds.includes(r.chapterId) || !r.questions) return
    if (wbFilter.value && r.chapterId !== wbFilter.value) return
    r.questions.forEach((q, qi) => {
      if (q.isCorrect !== false) return
      out.push({ key: r.chapterId + ':' + r.id + ':' + qi, qId: getQuestionId(r.chapterId, q), cid: r.chapterId, q, userAnswer: q.userAnswer, roundDate: r.date || '' })
    })
  })
  return out
})
function wbCache(item) { return (data.state.wrongBook || {})[item.qId] }
function fmtWhen(at) { if (!at) return ''; try { return new Date(at).toLocaleString('zh-CN') } catch (e) { return '' } }
function answerText(q, ans) {
  if (ans === undefined || ans === null || ans === '') return '（未作答）'
  if ((q.type === 'single' || q.type === 'judge') && typeof ans === 'number' && Array.isArray(q.options) && q.options[ans] !== undefined) return letter(ans) + '. ' + q.options[ans]
  return String(ans)
}
async function askExplain(item) {
  if (wbLoading[item.key]) return
  wbLoading[item.key] = true
  wbOpen[item.key] = true
  try {
    const ch = data.state.chapters[item.cid]
    const context = (ch && ch.name) ? '章节：' + ch.name : ''
    await ai.explainWrongAnswer({ q: item.q, qId: item.qId, cid: item.cid, userAnswer: item.userAnswer, force: true }, context)
    ui.toast('讲解已生成（可回看）', 'ok')
  } catch (e) {
    wbOpen[item.key] = false
    ui.toast((e && e.message) || '讲解生成失败，请检查 AI 配置', 'err')
  } finally {
    wbLoading[item.key] = false
  }
}
function exportChapter() {
  const ch = data.getCh()
  if (!ch || !ch.questions || ch.questions.length === 0) { ui.toast('当前章节没有可导出的题目', 'err'); return }
  const json = exportQuestionsJson(ch.questions, { chapterName: ch.name, chapterId: ch.id, exportedAt: new Date().toISOString() })
  const pad = (n) => String(n).padStart(2, '0')
  const d = new Date()
  downloadTextFile('Qbao_' + (ch.name || '章节') + '_' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '.json', json)
  ui.toast('已导出 ' + ch.questions.length + ' 道题目', 'ok')
}

const tabs = [
  { key: 'overview', label: '总览' },
  { key: 'questionbank', label: '题库' },
  { key: 'compose-exam', label: '大考卷' },
  { key: 'wrongbook', label: '错题本' },
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
const examColors = ['#EF4444', '#F59E0B', '#10B981', '#4D6BFE', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#84CC16']

function rateColor(rate) {
  const s = String(t || '')
  return s.length > n ? s.substring(0, n) + '...' : s
}
function qbIconClass(ci) {
  if (ci === true) return 'ok'
  if (ci === false) return 'bad'
  return 'pending'
}

// —— 题库 ——
const qbOnlyWrong = ref(false)
const qbKeyword = ref('')
// 题库折叠：每个章节一个可折叠分组，默认只展开第一个；单组内最多先渲染 50 条
const openQbGroups = reactive(new Set())
const qbLimits = reactive({})
function toggleQbGroup(cid) {
  if (openQbGroups.has(cid)) openQbGroups.delete(cid)
  else openQbGroups.add(cid)
}
function shownQbItems(group) {
  return group.items.slice(0, qbLimits[group.cid] || 50)
}
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

// 题库分组默认折叠：只自动展开第一个有内容的分组，其余点击标题展开
watch(qbankGroups, (groups) => {
  if (!groups.length) return
  if (!groups.some((g) => openQbGroups.has(g.cid))) {
    groups.forEach((g) => openQbGroups.delete(g.cid))
    openQbGroups.add(groups[0].cid)
  }
})

// —— P3.3 批量编辑（选择模式：移动/删除/设标签） ——
const qbSelectMode = ref(false)
const qbSelected = reactive(new Set())
const qbMoveTarget = ref('')

function qbEnterSelect() { qbSelectMode.value = true; qbSelected.clear() }
function qbExitSelect() { qbSelectMode.value = false; qbSelected.clear(); qbMoveTarget.value = '' }
function qbToggleSelect(key) { if (qbSelected.has(key)) qbSelected.delete(key); else qbSelected.add(key) }

// 选中项还原为 qbankGroups 中的条目（含 q/章节引用）
const qbSelectedItems = computed(() => {
  const byKey = {}
  qbankGroups.value.forEach((g) => g.items.forEach((it) => { byKey[it.key] = it }))
  return Array.from(qbSelected).map((k) => byKey[k]).filter(Boolean)
})

// 按签名在题库（ch.questions）中定位（history 副本 → 题库本体）
function findInChapter(ch, q) {
  return (ch && ch.questions && ch.questions.findIndex((x) => x.question === q.question && x.type === q.type && x.answer === q.answer)) ?? -1
}
function qbBulkDelete() {
  const items = qbSelectedItems.value
  if (!items.length) { ui.toast('请先勾选题目', 'err'); return }
  ui.openConfirm('批量删除', '确定删除选中的 ' + items.length + ' 道题目？将从题库与 SRS 复习计划中移除（历史记录保留）。', '删除', { danger: true }).then((ok) => {
    if (!ok) return
    let removed = 0
    const removal = new Set(items.map((it) => JSON.stringify([it.cid, it.q.question, it.q.type, it.q.answer])))
    Object.keys(data.state.chapters).forEach((cid) => {
      const ch = data.state.chapters[cid]
      if (!ch || !Array.isArray(ch.questions)) return
      const keep = []
      const keepAns = []
      ch.questions.forEach((q, i) => {
        const sig = JSON.stringify([cid, q.question, q.type, q.answer])
        if (removal.has(sig)) {
          removed++
          delete data.state.srsData[getQuestionId(cid, q)]
        } else {
          keep.push(q)
          if (ch.userAnswers) keepAns.push(ch.userAnswers[i])
        }
      })
      ch.questions = keep
      if (ch.userAnswers) ch.userAnswers = keepAns
      // quizSets 中相同签名一并移除（轮次不残留孤儿题）
      if (Array.isArray(ch.quizSets)) {
        ch.quizSets.forEach((set) => {
          if (!Array.isArray(set.questions)) return
          const kq = [], ka = []
          set.questions.forEach((q, i) => {
            const sig = JSON.stringify([cid, q.question, q.type, q.answer])
            if (removal.has(sig)) return
            kq.push(q); if (set.userAnswers) ka.push(set.userAnswers[i])
          })
          set.questions = kq
          if (set.userAnswers) set.userAnswers = ka
        })
        ch.quizSets = ch.quizSets.filter((set) => !set.questions || set.questions.length > 0)
      }
    })
    data.saveState()
    qbExitSelect()
    ui.toast('已删除 ' + removed + ' 道题目', 'ok')
  }).catch(() => {})
}

const qbMoveChapters = computed(() => {
  const s = subj.value
  if (!s) return []
  return s.chapterIds.map((cid) => ({ cid, name: (data.state.chapters[cid] || {}).name || cid }))
})
function qbBulkMove() {
  const targetCid = qbMoveTarget.value
  const items = qbSelectedItems.value
  if (!targetCid) { ui.toast('请先选择目标章节', 'err'); return }
  if (!items.length) return
  const target = data.state.chapters[targetCid]
  if (!target) return
  if (!target.questions) target.questions = []
  if (!target.userAnswers) target.userAnswers = []
  let moved = 0
  const sigs = new Set(items.map((it) => JSON.stringify([it.q.question, it.q.type, it.q.answer])))
  Object.keys(data.state.chapters).forEach((cid) => {
    if (cid === targetCid) return
    const ch = data.state.chapters[cid]
    if (!ch || !Array.isArray(ch.questions)) return
    const keep = [], keepAns = []
    ch.questions.forEach((q, i) => {
      const sig = JSON.stringify([q.question, q.type, q.answer])
      if (sigs.has(sig) && !target.questions.some((x) => x.question === q.question && x.type === q.type)) {
        target.questions.push(q)
        target.userAnswers.push(ch.userAnswers ? ch.userAnswers[i] : undefined)
        moved++
      } else {
        keep.push(q)
        if (ch.userAnswers) keepAns.push(ch.userAnswers[i])
      }
    })
    ch.questions = keep
    if (ch.userAnswers) ch.userAnswers = keepAns
  })
  data.saveState()
  qbExitSelect()
  ui.toast('已移动 ' + moved + ' 道到 ' + (target.name || '目标章节'), 'ok')
}
function qbBulkTag() {
  const items = qbSelectedItems.value
  if (!items.length) { ui.toast('请先勾选题目', 'err'); return }
  ui.openPrompt('设置标签', '').then((tag) => {
    if (tag == null) return
    const t = String(tag).trim()
    if (!t) { ui.toast('标签不能为空', 'err'); return }
    let tagged = 0
    items.forEach((it) => {
      const ch = data.state.chapters[it.cid]
      const idx = ch && findInChapter(ch, it.q)
      if (ch && idx >= 0) { ch.questions[idx].tag = t; tagged++ }
    })
    data.saveState()
    qbExitSelect()
    ui.toast('已为 ' + tagged + ' 道题目设置标签「' + t + '」', 'ok')
  }).catch(() => {})
}
// 移动目标变化即执行（select 下拉触发）
watch(qbMoveTarget, (v) => { if (v) { qbBulkMove() } })

// —— 大考卷 ——
const examTypes = [
  { key: 'single', label: '单选' },
  { key: 'judge', label: '判断' },

  { key: 'term', label: '名词解释' },
  { key: 'short', label: '简答' }
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
  ui.toast('大考卷已生成：共 ' + result.exam.questions.length + ' 题', 'ok')
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
.qbank-toolbar { display: flex; align-items: center; gap: var(--space-md); margin-bottom: var(--space-md); flex-wrap: wrap; }
.qb-check { display: flex; align-items: center; gap: 6px; font-size: var(--fs-sm); color: var(--text-secondary); cursor: pointer; }
.qb-check input { accent-color: var(--color-primary); }
.qb-search { display: flex; align-items: center; gap: 6px; color: var(--text-muted); flex: 1; max-width: 320px; }
.qb-input { border: none; background: transparent; flex: 1; padding: 6px 8px; border-radius: var(--radius-sm); background: var(--surface-hover); font-size: var(--fs-sm); }
.qb-input:focus { outline: 2px solid var(--color-primary); outline-offset: -2px; }
.qb-header { display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; }
.qb-header:hover { color: var(--color-primary); }
.qb-caret { display: flex; color: var(--text-muted); transition: transform var(--transition-fast); }
.qb-caret .icon.rotated { transform: rotate(-90deg); }
.qb-meta { margin-left: auto; font-weight: 400; font-size: var(--fs-xs); color: var(--text-muted); }
.qb-more {
  width: 100%;
  padding: 8px;
  font-size: var(--fs-xs);
  color: var(--color-primary);
  border-radius: var(--radius-sm);
  margin-top: 2px;
}
.qb-more:hover { background: var(--color-primary-light); }
.qb-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  margin-bottom: 3px;
  border: 1px solid transparent;
  transition: border-color var(--transition-fast), background var(--transition-fast);
  min-height: 28px;
}
.qb-item:hover { border-color: var(--color-primary); background: var(--surface-hover); }
.qb-item.correct { background: var(--color-success-light); border-color: var(--color-success-light); }
.qb-item.wrong { background: var(--color-danger-light); border-color: var(--color-danger-light); }
.qb-text { flex: 1; min-width: 0; }
.qb-q { font-size: var(--fs-sm); line-height: 1.45; display: flex; align-items: center; gap: 6px; }
.qb-icon { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: var(--text-faint); display: inline-block; }
.qb-icon.ok { background: var(--color-success); }
.qb-icon.bad { background: var(--color-danger); }
.qb-icon.pending { background: var(--text-faint); }
.qb-detail { font-size: var(--fs-xs); color: var(--text-muted); margin-top: 1px; }
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
.strategy-labels span { display: inline-flex; align-items: center; gap: 4px; }
.pct-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
.pct-dot.err { background: #EF4444; }
.pct-dot.review { background: #F59E0B; }
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
.exam-icon { flex-shrink: 0; color: var(--text-muted); display: flex; align-items: center; }
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
}
.qb-tool-actions { display: flex; gap: var(--space-sm); margin-left: auto; }
.wb-item { padding: var(--space-sm) 0; }
.wb-qline { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.wb-type { font-size: var(--fs-xs); color: var(--color-primary); background: var(--color-primary-light); border-radius: var(--radius-sm); padding: 0 6px; line-height: 18px; flex-shrink: 0; }
.wb-q { font-size: var(--fs-sm); font-weight: 500; }
.wb-tag { font-size: var(--fs-xs); padding: 1px 8px; border-radius: 999px; border: 1px solid var(--border-default); color: var(--text-secondary); }
.wb-answers { display: flex; gap: var(--space-md); flex-wrap: wrap; margin-top: 4px; font-size: var(--fs-xs); color: var(--text-secondary); }
.wb-ans.wrong { color: var(--color-danger); }
.wb-ans.right { color: var(--color-success); }
.wb-date { color: var(--text-muted); margin-left: auto; }
.wb-actions { margin-top: 6px; }
.wb-explanation { margin-top: var(--space-sm); padding: var(--space-md); background: var(--surface-hover); border-left: 3px solid var(--color-primary); border-radius: var(--radius-md); font-size: var(--fs-sm); line-height: 1.8; }
.wb-exp-head { font-weight: 600; margin-bottom: 6px; display: flex; gap: var(--space-sm); align-items: baseline; }
.wb-exp-meta { font-weight: 400; font-size: var(--fs-xs); color: var(--text-muted); }
.markdown-body { word-break: break-word; }
.qb-sel-count { font-size: var(--fs-xs); color: var(--color-primary); }
.qb-sel-box { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border: 1px solid var(--border-default); border-radius: 4px; color: var(--text-muted); flex-shrink: 0; }
.qb-sel-box.on { background: var(--color-primary); border-color: var(--color-primary); color: #fff; }
</style>