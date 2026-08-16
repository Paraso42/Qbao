// 答题历史（自 legacy history.js，纯逻辑 + 渲染数据准备）
import { getCi, isObjType } from './utils'
import { calcStats } from './questions'

export function saveQuizHistory(state, as) {
  if (!as || !as.questions || !as.questions.length) return
  const stats = calcStats(as)
  const record = {
    id: Date.now().toString(36),
    chapterId: as.setId,
    chapterName: as.setName,
    date: new Date().toLocaleString('zh-CN'),
    total: stats.total,
    correct: stats.objCorrect + stats.subjCount,
    wrong: stats.wrongCount,
    rate: stats.objTotal > 0 ? Math.round((stats.objCorrect / stats.objTotal) * 100) : 0,
    questions: as.questions.map((q, i) => ({
      question: q.question, type: q.type, tag: q.tag,
      userAnswer: as.userAnswers && as.userAnswers[i],
      answer: q.answer, explanation: q.explanation, options: q.options,
      isCorrect: getCi(q, as.userAnswers && as.userAnswers[i])
    }))
  }
  if (!state.history) state.history = []
  state.history.push(record)
  if (state.history.length > 100) state.history = state.history.slice(-100)
}
