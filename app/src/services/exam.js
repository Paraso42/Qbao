// 大考卷设置与组卷（自 legacy exam.js 抽取，纯逻辑）
import { isQuestionIgnored } from './questions'

export const EXAM_DEFAULTS = {
  typeCounts: { single: 20, judge: 10, term: 5, short: 1 },
  errPct: 30, reviewPct: 70, newPct: 0
}

export function getExamSettings(state, subjId) {
  if (!state._examSettings) state._examSettings = {}
  if (!state._examSettings[subjId]) {
    state._examSettings[subjId] = {
      typeCounts: { ...EXAM_DEFAULTS.typeCounts },
      errPct: EXAM_DEFAULTS.errPct,
      reviewPct: EXAM_DEFAULTS.reviewPct,
      newPct: EXAM_DEFAULTS.newPct,
      _examCumSliders: null,
      _checkedCids: []
    }
  }
  return state._examSettings[subjId]
}

// 各章节按权重分配题数（最大余数法）
export function distributeCounts(count, cidList, wList) {
  if (count === 0) return new Array(cidList.length).fill(0)
  const raw = wList.map((w) => (w / 100) * count)
  const results = raw.map(Math.floor)
  let remain = count - results.reduce((a, b) => a + b, 0)
  while (remain > 0) {
    let maxIdx = 0
    for (let i = 0; i < results.length; i++) {
      if (raw[i] - results[i] > raw[maxIdx] - results[maxIdx]) maxIdx = i
    }
    results[maxIdx]++
    remain--
  }
  return results
}

function pickQuestions(state, chId, type, count) {
  if (count <= 0) return []
  let pool = []
  ;(state.history || []).filter((r) => r.chapterId === chId).forEach((r) => {
    if (r.questions) r.questions.forEach((q) => { if (q.type === type) pool.push({ ...q }) })
  })
  const ch = state.chapters[chId]
  if (ch && ch.questions) {
    ch.questions.forEach((q, idx) => { if (q.type === type && ch.userAnswers[idx] === undefined) pool.push({ ...q }) })
    if (pool.length < count) {
      ch.questions.forEach((q, idx) => { if (q.type === type && ch.userAnswers[idx] !== undefined) pool.push({ ...q }) })
    }
  }
  pool = pool.filter((q) => !isQuestionIgnored(state, chId, q))
  const shuffled = [...pool]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled.slice(0, count)
}

// 返回 { exam } 或 { error }（供 UI toast/alert）
export function composeSubjExam(state, subjId, checkedCids, typeCounts, weights) {
  const s = state.subjects[subjId]
  if (!s) return { error: '科目不存在' }
  if (!checkedCids || checkedCids.length === 0) return { error: '请至少选择一个章节' }
  const ts = typeCounts.single || 0
  const tj = typeCounts.judge || 0
  const tt = typeCounts.term || 0
  const tsh = typeCounts.short || 0
  if (ts + tj + tt + tsh === 0) return { error: '请设置至少 1 道题' }

  let aS = 0, aJ = 0, aT = 0, aSh = 0
  checkedCids.forEach((cid) => {
    const ch = state.chapters[cid]
    if (ch && ch.questions) {
      ch.questions.forEach((q) => {
        if (q.type === 'single') aS++
        else if (q.type === 'judge') aJ++
        else if (q.type === 'term') aT++
        else if (q.type === 'short') aSh++
      })
    }
    ;(state.history || []).filter((r) => r.chapterId === cid).forEach((r) => {
      if (r.questions) {
        r.questions.forEach((q) => {
          if (q.type === 'single') aS++
          else if (q.type === 'judge') aJ++
          else if (q.type === 'term') aT++
          else if (q.type === 'short') aSh++
        })
      }
    })
  })
  if (ts > aS) return { error: '单选需求 ' + ts + '，可用 ' + aS }
  if (tj > aJ) return { error: '判断需求 ' + tj + '，可用 ' + aJ }
  if (tt > aT) return { error: '名词解释需求 ' + tt + '，可用 ' + aT }
  if (tsh > aSh) return { error: '简答需求 ' + tsh + '，可用 ' + aSh }

  const cids = checkedCids
  const wList = weights && weights.length === cids.length ? weights : new Array(cids.length).fill(Math.floor(100 / cids.length))

  const sD = distributeCounts(ts, cids, wList)
  const jD = distributeCounts(tj, cids, wList)
  const tD = distributeCounts(tt, cids, wList)
  const shD = distributeCounts(tsh, cids, wList)

  const selected = []
  cids.forEach((cid, idx) => {
    selected.push(...pickQuestions(state, cid, 'single', sD[idx]))
    selected.push(...pickQuestions(state, cid, 'judge', jD[idx]))
    selected.push(...pickQuestions(state, cid, 'term', tD[idx]))
    selected.push(...pickQuestions(state, cid, 'short', shD[idx]))
  })
  if (selected.length === 0) return { error: '未能抽取题目' }

  const eid = 'exam_' + Date.now().toString(36)
  const genExam = {
    id: eid,
    name: '大考卷 ' + new Date().toLocaleString('zh-CN'),
    type: 'exam',
    subjectId: subjId,
    questions: selected,
    userAnswers: new Array(selected.length).fill(undefined),
    currentIdx: 0,
    createdAt: Date.now()
  }
  state.generatedExams[eid] = genExam
  state.currentExamId = eid
  return { exam: genExam }
}
