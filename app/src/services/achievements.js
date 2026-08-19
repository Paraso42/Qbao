// 成就系统（自 legacy achievements.js）
import { isObjType } from './utils'

export const ACHIEVEMENT_ACTIONS = [
  { id: 'first_step', name: '迈出第一步', icon: 'ach-step', desc: '完成第一次答题', check: (g) => g.totalAnswered >= 1 },
  { id: 'first_correct', name: '初次正确', icon: 'ach-sparkle', desc: '第一次答对客观题', check: (g) => g.totalCorrect >= 1 },
  { id: 'first_chapter', name: '开卷有益', icon: 'ach-book', desc: '完成第一轮答题', check: (g) => g.totalRounds >= 1 },
  { id: 'five_answers', name: '初露锋芒', icon: 'ach-star', desc: '累计答题5道', check: (g) => g.totalAnswered >= 5 },
  { id: 'ten_correct', name: '初战告捷', icon: 'ach-target', desc: '累计答对10道客观题', check: (g) => g.totalCorrect >= 10 },
  { id: 'streak_5', name: '势如破竹', icon: 'ach-flame', desc: '连续答对5题', check: (g) => g.maxStreak >= 5 },
  { id: 'ten_questions', name: '勤学好问', icon: 'ach-pencil', desc: '累计答题10道', check: (g) => g.totalAnswered >= 10 },
  { id: 'three_chapters', name: '博采众长', icon: 'ach-books', desc: '创建3个章节', check: (g) => g.totalChapters >= 3 },
  { id: 'two_subjects', name: '学科兼修', icon: 'ach-grad', desc: '创建2个科目', check: (g) => g.totalSubjects >= 2 },
  { id: 'fifty_questions', name: '题海泛舟', icon: 'ach-wave', desc: '累计答题50道', check: (g) => g.totalAnswered >= 50 },
  { id: 'hundred_correct', name: '百步穿杨', icon: 'ach-archery', desc: '累计答对100道客观题', check: (g) => g.totalCorrect >= 100 },
  { id: 'streak_10', name: '连胜纪录', icon: 'ach-bolt', desc: '连续答对10题', check: (g) => g.maxStreak >= 10 },
  { id: 'five_subjects', name: '博学多才', icon: 'ach-globe', desc: '创建5个科目', check: (g) => g.totalSubjects >= 5 },
  { id: 'hundred_questions', name: '学富五车', icon: 'ach-landmark', desc: '累计答题100道', check: (g) => g.totalAnswered >= 100 },
  { id: 'five_hundred_q', name: '学海无涯', icon: 'ach-ship', desc: '累计答题500道', check: (g) => g.totalAnswered >= 500 },
  { id: 'streak_20', name: '不可阻挡', icon: 'ach-muscle', desc: '连续答对20题', check: (g) => g.maxStreak >= 20 },
  { id: 'perfect_session', name: '完美发挥', icon: 'ach-perfect', desc: '一轮10题以上全部答对', check: (g) => g.hasPerfectSession },
  { id: 'ten_subjects', name: '满腹经纶', icon: 'ach-crown', desc: '创建10个科目', check: (g) => g.totalSubjects >= 10 },
  { id: 'thousand_questions', name: '题海大师', icon: 'ach-trophy', desc: '累计答题1000道', check: (g) => g.totalAnswered >= 1000 },
  { id: 'streak_50', name: '神话传说', icon: 'ach-dragon', desc: '连续答对50题', check: (g) => g.maxStreak >= 50 }
]

export function computeGlobalStats(state) {
  let totalAnswered = 0, totalCorrect = 0, totalWrong = 0
  let totalRounds = state.history ? state.history.length : 0
  let maxStreak = 0, hasPerfectSession = false
  const typeDist = { single: 0, judge: 0, term: 0, short: 0 }
  ;(state.history || []).forEach((r) => {
    if (!r.questions) return
    let streak = 0
    r.questions.forEach((q) => {
      typeDist[q.type] = (typeDist[q.type] || 0) + 1
      if (q.userAnswer !== undefined) {
        totalAnswered++
        if (isObjType(q.type)) {
          if (q.isCorrect === true) { totalCorrect++; streak++; if (streak > maxStreak) maxStreak = streak }
          else { totalWrong++; streak = 0 }
        }
      }
    })
    if (r.total >= 10 && r.wrong === 0) hasPerfectSession = true
  })
  const totalChapters = Object.values(state.chapters).filter((ch) => ch.questions && ch.questions.length > 0).length
  return { totalAnswered, totalCorrect, totalWrong, totalRounds, maxStreak, hasPerfectSession, totalSubjects: Object.keys(state.subjects).length, totalChapters, typeDist }
}

// 返回新解锁的成就 id 列表（空数组 = 无新解锁）
export function checkAchievements(state) {
  if (!state.achievements) state.achievements = { unlocked: [], history: [] }
  const g = computeGlobalStats(state)
  const newUnlocks = []
  ACHIEVEMENT_ACTIONS.forEach((a) => {
    if (!state.achievements.unlocked.includes(a.id) && a.check(g)) {
      state.achievements.unlocked.push(a.id)
      state.achievements.history.push({ id: a.id, date: new Date().toLocaleString('zh-CN') })
      newUnlocks.push(a)
    }
  })
  return newUnlocks
}