// SRS 间隔重复（SM-2 算法，自 legacy srs.js）
import { isObjType, getCi } from './utils'
import { getQuestionId } from './questions'

export function getSRSData(state, qId) {
  if (!state.srsData || !state.srsData[qId]) state.srsData[qId] = { interval: 0, easeFactor: 2.5, repetitions: 0, nextReview: 0 }
  return state.srsData[qId]
}

export function getSrsDueQuestions(state) {
  const now = Date.now()
  return Object.keys(state.srsData || {}).filter((id) => state.srsData[id].nextReview > 0 && state.srsData[id].nextReview <= now)
}

export function getOverdueCount(state) { return getSrsDueQuestions(state).length }

export function updateSRSAfterExam(state, as) {
  if (!state.srsData) state.srsData = {}
  const now = Date.now()
  as.questions.forEach((q, i) => {
    if (!isObjType(q.type) || as.userAnswers[i] === undefined) return
    const qId = getQuestionId(as.setId, q)
    const ci = getCi(q, as.userAnswers[i])
    const srs = getSRSData(state, qId)
    if (ci === true) {
      if (srs.repetitions === 0) srs.interval = 1
      else if (srs.repetitions === 1) srs.interval = 3
      else srs.interval = Math.round(srs.interval * srs.easeFactor)
      srs.repetitions++
    } else {
      srs.interval = 1
      srs.repetitions = 0
      srs.easeFactor = Math.max(1.3, srs.easeFactor - 0.2)
    }
    const days = srs.interval * 86400000
    srs.nextReview = now + days
  })
}

export function populateSRSFromHistory(state) {
  if (!state.srsData) state.srsData = {}
  let added = 0
  ;(state.history || []).forEach((r) => {
    if (!r.questions) return
    r.questions.forEach((q) => {
      if (!isObjType(q.type) || q.userAnswer === undefined) return
      const qId = getQuestionId(r.chapterId, q)
      if (!state.srsData[qId]) {
        state.srsData[qId] = { interval: 0, easeFactor: 2.5, repetitions: 0, nextReview: 0 }
        added++
      }
      const srs = state.srsData[qId]
      const ci = q.isCorrect
      if (ci === true) {
        if (srs.repetitions === 0) srs.interval = 1
        else if (srs.repetitions === 1) srs.interval = 3
        else srs.interval = Math.round(srs.interval * srs.easeFactor)
        srs.repetitions++
      } else {
        srs.interval = 1
        srs.repetitions = 0
        srs.easeFactor = Math.max(1.3, srs.easeFactor - 0.2)
      }
    })
  })
  if (added > 0) return added
  return added
}

// 生成一次 SRS 复习（返回 exam id，纯数据构建；UI 由 quiz store 负责开始）
export function buildSrsExam(state) {
  const due = getSrsDueQuestions(state)
  if (!due.length) return null
  const questions = []
  due.forEach((qId) => {
    for (const cid in state.chapters) {
      const ch = state.chapters[cid]
      if (!ch || !ch.questions) continue
      for (const q of ch.questions) {
        if (getQuestionId(cid, q) === qId) {
          questions.push({ ...q, _srsChapterId: cid })
          break
        }
      }
      if (questions.length > 0) break
    }
  })
  if (!questions.length) return null
  const sid = state.currentSubjectId || Object.keys(state.subjects)[0]
  const eid = 'srs_' + Date.now().toString(36)
  const genExam = {
    id: eid,
    name: '📅 间隔复习 ' + new Date().toLocaleDateString('zh-CN'),
    type: 'srs',
    subjectId: sid,
    questions,
    userAnswers: new Array(questions.length).fill(undefined),
    currentIdx: 0,
    createdAt: Date.now()
  }
  state.generatedExams[eid] = genExam
  state.currentExamId = eid
  return eid
}
