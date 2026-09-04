// 题目工具：id/忽略/统计/标签重分类（自 legacy quiz-engine/ai-workflow 抽取）
import { isObjType, getCi } from './utils'
import { getChStrategy } from './persistence'

export function simpleHash(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0
  return h.toString(36)
}

export function getQuestionId(chId, q) { return chId + ':' + simpleHash((q.question || '')) }

export function isQuestionIgnored(state, chId, q) {
  return state.ignoredQuestions && state.ignoredQuestions.includes(getQuestionId(chId, q))
}

export function calcStats(as) {
  if (!as || !as.questions) return { total: 0, answered: 0, objCorrect: 0, objTotal: 0, wrongCount: 0, subjCount: 0 }
  let total = as.questions.length, answered = 0, objCorrect = 0, objTotal = 0, wrongCount = 0, subjCount = 0
  as.questions.forEach((q, i) => {
    const ans = as.userAnswers && as.userAnswers[i]
    if (ans !== undefined && ans !== -1) answered++
    if (isObjType(q.type)) {
      objTotal++
      if (ans !== undefined && ans !== -1) {
        const ci = getCi(q, ans)
        if (ci === true) objCorrect++
        else if (ci === false) wrongCount++
      }
    } else {
      if (ans !== undefined && ans !== -1) subjCount++
    }
  })
  return { total, answered, objCorrect, objTotal, wrongCount, subjCount }
}

export function calcChapterStats(state, chapterId) {
  const result = { total: 0, answered: 0, objCorrect: 0, objTotal: 0, wrongCount: 0, subjCount: 0, completedSets: 0 }
  const ch = state.chapters[chapterId]
  if (!ch || !ch.quizSets) return result
  ch.quizSets.forEach(function (set) {
    const stats = calcStats(set)
    if (stats.answered >= stats.total && stats.total > 0) {
      result.total += stats.total
      result.answered += stats.answered
      result.objCorrect += stats.objCorrect
      result.objTotal += stats.objTotal
      result.wrongCount += stats.wrongCount
      result.subjCount += stats.subjCount
      result.completedSets++
    }
  })
  return result
}

// 基于本轮统计重新分类标签，同时保留不在本轮中的历史标签
export function reclassifyTagsByRound(s) {
  const rts = s._roundTagStats || {}
  const keepError = (s.errorTags || []).filter((t) => !rts[t])
  const keepReview = (s.reviewTags || []).filter((t) => !rts[t])

  const pendingError = (s.errorTags || []).filter((t) => {
    if (!rts[t]) return false
    return (rts[t].correct + rts[t].wrong) < rts[t].total
  })
  const pendingReview = (s.reviewTags || []).filter((t) => {
    if (!rts[t]) return false
    return (rts[t].correct + rts[t].wrong) < rts[t].total
  })

  const autoError = [], autoReview = []
  Object.keys(rts).forEach(function (tag) {
    const rs = rts[tag]
    if (rs.correct + rs.wrong < rs.total) return
    if (rs.wrong > 0) autoError.push(tag)
    else autoReview.push(tag)
  })

  const errSet = {}, revSet = {}
  keepError.forEach((t) => { errSet[t] = true })
  pendingError.forEach((t) => { errSet[t] = true })
  keepReview.forEach((t) => { revSet[t] = true })
  pendingReview.forEach((t) => { revSet[t] = true })
  autoError.forEach((t) => { if (!revSet[t]) errSet[t] = true })
  autoReview.forEach((t) => { if (!errSet[t]) revSet[t] = true })

  s.errorTags = Object.keys(errSet)
  s.reviewTags = Object.keys(revSet)

  if (s.newTopicTags && s.newTopicTags.length > 0) {
    s.newTopicTags = s.newTopicTags.filter(function (t) {
      const m = s.tagMeta && s.tagMeta[t]
      return !m || m.totalQ === 0
    })
  }
}


// 章节题库答案对齐：题库（ch.questions）可能经多端去重合并（按题干并集），
// 与各轮 quizSets 的拼接顺序不再一一对应。按题干把各轮已答答案回填到题库
// 对应位置（轮次顺序优先，早轮先占位），保证 ch.userAnswers 与 ch.questions
// 始终同序同长——章节正确率/错题统计/大考卷报告才不串位。
export function rebuildChapterAnswersFromSets(ch) {
  if (!ch || !Array.isArray(ch.quizSets) || ch.quizSets.length === 0) return
  if (!Array.isArray(ch.questions) || ch.questions.length === 0) { ch.userAnswers = []; return }
  const ans = new Array(ch.questions.length).fill(undefined)
  const byText = new Map()
  ch.questions.forEach((q, i) => {
    if (q && q.question && !byText.has(q.question)) byText.set(q.question, i)
  })
  for (const set of ch.quizSets) {
    if (!set || !Array.isArray(set.questions)) continue
    const ua = set.userAnswers
    set.questions.forEach((q, i) => {
      if (!q || !q.question) return
      const poolIdx = byText.get(q.question)
      if (poolIdx === undefined) return
      const a = ua && ua[i]
      if (a === undefined || a === null || a === -1) return
      const cur = ans[poolIdx]
      if (cur === undefined || cur === null) ans[poolIdx] = a
    })
  }
  ch.userAnswers = ans
}

// 单题标签统计更新 — 每道题作答后立即更新
export function syncSingleAnswerToTagMeta(state, chapterId, question, answerVal) {
  if (!question || !question.tag) return
  const s = getChStrategy(state, chapterId)
  if (!s) return
  if (!s._roundTagStats) s._roundTagStats = {}
  if (!s._roundTagStats[question.tag]) s._roundTagStats[question.tag] = { correct: 0, wrong: 0, total: 0 }
  const ci = isObjType(question.type) ? getCi(question, answerVal) : (answerVal !== undefined && answerVal !== null && answerVal !== -1)
  if (ci === true) s._roundTagStats[question.tag].correct++
  else s._roundTagStats[question.tag].wrong++
  if (!s.tagMeta) s.tagMeta = {}
  if (!s.tagMeta[question.tag]) s.tagMeta[question.tag] = { totalQ: 0, correct: 0 }
  s.tagMeta[question.tag].totalQ++
  if (ci === true) s.tagMeta[question.tag].correct++
  s.tagMeta[question.tag].lastAnswer = Date.now()
  reclassifyTagsByRound(s)
}

// 结算时覆盖未被单题函数处理的答案（如直接点"结束"跳过的题目）
export function autoUpdateChapterWeakTags(state, ch, as) {
  if (!ch) return
  const s = getChStrategy(state, ch.id)
  if (!s) return
  if (!as || !as.questions) {
    const sets = ch.quizSets || []
    as = sets.length > 0 ? sets[sets.length - 1] : null
  }
  if (!as) return
  ;(as.questions || []).forEach(function (q, qi) {
    if (!q.tag) return
    if (as._tagSynced && as._tagSynced[qi]) return
    const ans = as.userAnswers && as.userAnswers[qi]
    if (ans === undefined || ans === -1 || ans === null) return
    if (!s._roundTagStats) s._roundTagStats = {}
    if (!s._roundTagStats[q.tag]) s._roundTagStats[q.tag] = { correct: 0, wrong: 0, total: 0 }
    const ci = isObjType(q.type) ? getCi(q, ans) : (ans !== undefined && ans !== null && ans !== -1)
    if (ci === true) s._roundTagStats[q.tag].correct++
    else s._roundTagStats[q.tag].wrong++
    if (!s.tagMeta) s.tagMeta = {}
    if (!s.tagMeta[q.tag]) s.tagMeta[q.tag] = { totalQ: 0, correct: 0 }
    s.tagMeta[q.tag].totalQ++
    if (ci === true) s.tagMeta[q.tag].correct++
    s.tagMeta[q.tag].lastAnswer = Date.now()
    if (as._tagSynced) as._tagSynced[qi] = true
  })
  reclassifyTagsByRound(s)
  if (!s.newTopicTags) s.newTopicTags = []
}
