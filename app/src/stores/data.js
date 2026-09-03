// 应用数据仓库：整个 state（subjects/chapters/history/…）以 legacy 结构存放，
// localStorage 兼容不变；所有写操作经 saveState() 持久化并调度同步。
import { defineStore } from 'pinia'
import { reactive } from 'vue'
import * as persistence from '../services/persistence'

let syncHook = null

export const useDataStore = defineStore('data', () => {
  const state = reactive(persistence.migrateState(persistence.loadState()))

  function saveState() {
    persistence.saveState(state)
    if (typeof syncHook === 'function') syncHook()
  }

  function setSyncHook(fn) { syncHook = fn }

  // 合并后整体替换 state（保持响应性；供同步 409 合并使用）
  function replaceState(merged) {
    Object.keys(state).forEach((k) => { delete state[k] })
    Object.assign(state, merged)
  }

  // —— 访问器（同 legacy state.js） ——
  function getCh() { return state.chapters[state.currentChapterId] || null }
  function getSubj() { return state.subjects[state.currentSubjectId] || null }
  function getExam() { return state.generatedExams[state.currentExamId] || null }

  function getActiveSet() {
    const ex = getExam()
    if (ex) return {
      _ref: ex, questions: ex.questions,
      // userAnswers 用访问器绑定底层对象：替换（reset）与原位写都落到持久层（P1.4 修复）
      get userAnswers() { return ex.userAnswers },
      set userAnswers(v) { ex.userAnswers = v },
      currentIdx: ex.currentIdx, setCurrentIdx: (v) => { ex.currentIdx = v },
      setName: ex.name, isExam: true, setId: ex.id, subjectId: ex.subjectId
    }
    const ch = getCh()
    if (!ch) return null
    if (ch.quizSets && ch.quizSets.length > 0) {
      // 越界防御：currentQuizSetIdx 指向不存在的 set（合并/去重后）→ 回退到最后一个
      let idx = (typeof ch.currentQuizSetIdx === 'number' && ch.currentQuizSetIdx >= 0) ? ch.currentQuizSetIdx : ch.quizSets.length - 1
      if (idx >= ch.quizSets.length) idx = ch.quizSets.length - 1
      const qs = ch.quizSets[idx]
      if (qs && Array.isArray(qs.questions)) {
        return {
          _ref: qs, _isSet: true, questions: qs.questions,
          get userAnswers() { return qs.userAnswers },
          set userAnswers(v) { qs.userAnswers = v },
          currentIdx: qs.currentIdx, setCurrentIdx: (v) => { qs.currentIdx = v },
          setName: ch.name, isExam: false, setId: ch.id, subjectId: null
        }
      }
      ch.currentQuizSetIdx = idx
    }
    if (!Array.isArray(ch.questions) || ch.questions.length === 0) return null
    return {
      _ref: ch, questions: ch.questions,
      get userAnswers() { return ch.userAnswers },
      set userAnswers(v) { ch.userAnswers = v },
      currentIdx: ch.currentIdx, setCurrentIdx: (v) => { ch.currentIdx = v },
      setName: ch.name, isExam: false, setId: ch.id, subjectId: null
    }
  }

  function getCurrentQuizSet() {
    const ch = getCh()
    if (!ch || !ch.quizSets || ch.quizSets.length === 0) return null
    let idx = (typeof ch.currentQuizSetIdx === 'number' && ch.currentQuizSetIdx >= 0) ? ch.currentQuizSetIdx : ch.quizSets.length - 1
    // 越界防御：合并/去重后 currentQuizSetIdx 可能指向不存在的 set
    if (idx >= ch.quizSets.length) {
      idx = ch.quizSets.length - 1
      ch.currentQuizSetIdx = idx
    }
    const qs = ch.quizSets[idx]
    if (!qs || !Array.isArray(qs.questions)) return null
    return qs
  }

  function getChStrategy(cid) { return persistence.getChStrategy(state, cid) }

  function createQuizSetForChapter(questions, chId) {
    const ch = state.chapters[chId]
    if (!ch) return null
    if (!ch.quizSets) ch.quizSets = []
    // 去重防御：相同题目集合（按题干+类型+答案签名）已存在则直接复用，不再新建重复轮次
    if (Array.isArray(questions) && questions.length > 0) {
      const sig = questions.map((q) => JSON.stringify([q.question, q.type, q.answer])).join('\u0001')
      const dup = ch.quizSets.find((s) => s && Array.isArray(s.questions) &&
        s.questions.map((q) => JSON.stringify([q.question, q.type, q.answer])).join('\u0001') === sig)
      if (dup) {
        ch.currentQuizSetIdx = ch.quizSets.indexOf(dup)
        return dup
      }
    }
    const set = {
      questions: questions.slice(),
      userAnswers: new Array(questions.length).fill(undefined),
      currentIdx: 0,
      createdAt: Date.now()
    }
    ch.quizSets.push(set)
    ch.currentQuizSetIdx = ch.quizSets.length - 1
    // 同步到 ch.questions 题库，供科目总览/生成考卷/SRS 等聚合功能使用
    if (!ch.questions) ch.questions = []
    questions.forEach((q) => ch.questions.push(q))
    if (!ch.userAnswers) ch.userAnswers = []
    ch.userAnswers = ch.userAnswers.concat(new Array(questions.length).fill(undefined))
    if (typeof ch.currentIdx === 'undefined') ch.currentIdx = 0
    // 初始化本轮标签统计
    const s = getChStrategy(chId)
    if (s) {
      s._roundTagStats = {}
      questions.forEach(function (q) {
        if (!q.tag) return
        if (!s._roundTagStats[q.tag]) s._roundTagStats[q.tag] = { correct: 0, wrong: 0, total: 0 }
        s._roundTagStats[q.tag].total++
      })
    }
    return set
  }

  return {
    state, saveState, setSyncHook, replaceState,
    getCh, getSubj, getExam, getActiveSet, getCurrentQuizSet,
    getChStrategy, createQuizSetForChapter
  }
})
