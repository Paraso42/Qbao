// ============================================================
// chapterStats.js — 章节题量统计口径（v3.34）
// 规则：章节有轮次（quizSets）时，题量 = 各轮题目数之和（题库按轮次展示，
//       同一道题在不同轮次出现按轮次计数）；无轮次的旧章节回退到题库数组长度。
// 用于：章节页题量卡、侧栏 X/Y、科目总览当前题数、大考卷章节题数。
// ============================================================

export function chapterQuestionTotal(ch) {
  if (!ch) return 0
  if (Array.isArray(ch.quizSets) && ch.quizSets.length > 0) {
    let n = 0
    ch.quizSets.forEach((set) => {
      if (set && Array.isArray(set.questions)) n += set.questions.length
    })
    return n
  }
  return Array.isArray(ch.questions) ? ch.questions.length : 0
}

export function subjectQuestionTotal(state, subj) {
  if (!state || !subj || !Array.isArray(subj.chapterIds)) return 0
  let n = 0
  ;(subj.chapterIds || []).forEach((cid) => {
    n += chapterQuestionTotal(state.chapters && state.chapters[cid])
  })
  return n
}
