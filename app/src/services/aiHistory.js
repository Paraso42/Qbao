// ============================================================
// aiHistory.js — AI 章节历史统计（v3.32 P2.1 自 stores/ai.js 拆分）
// 纯函数：给定 state 与章节 id，统计该章节各轮次的做题分布（供生成提示词使用）。
// ============================================================
import { getCi } from './utils'

// 章节历史统计（供 chapterHistory 入参）：按轮次聚合题目/作答/错题标签 TOP10
export function collectChapterHistory(state, chapterId) {
  const ch = state.chapters[chapterId]
  if (!ch) return { totalQuestions: 0, totalAnswered: 0, totalWrong: 0, tagStats: {}, topWrongTags: [] }
  const tagStats = {}
  let totalQuestions = 0, totalAnswered = 0, totalWrong = 0
  ;(ch.quizSets || []).forEach((set) => {
    set.questions.forEach((q, qi) => {
      totalQuestions++
      const answer = set.userAnswers && set.userAnswers[qi]
      if (q.tag) {
        if (!tagStats[q.tag]) tagStats[q.tag] = { total: 0, correct: 0, wrong: 0 }
        tagStats[q.tag].total++
      }
      if (answer !== undefined) {
        totalAnswered++
        if (getCi(q, answer) === false) {
          totalWrong++
          if (q.tag && tagStats[q.tag]) tagStats[q.tag].wrong++
        } else {
          if (q.tag && tagStats[q.tag]) tagStats[q.tag].correct++
        }
      }
    })
  })
  const topWrongTags = Object.entries(tagStats)
    .sort((a, b) => b[1].wrong - a[1].wrong)
    .slice(0, 10)
    .map((e) => e[0])
  return { totalQuestions, totalAnswered, totalWrong, tagStats, topWrongTags }
}
