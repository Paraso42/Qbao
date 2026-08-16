// 应用数据仓库：整个 state（subjects/chapters/history/…）以 legacy 结构存放，
// localStorage 兼容不变；所有写操作经 saveState() 持久化并调度同步。
import { defineStore } from 'pinia'
import { reactive } from 'vue'
import * as persistence from '../services/persistence'

export const useDataStore = defineStore('data', () => {
  const state = reactive(persistence.migrateState(persistence.loadState()))

  function saveState() {
    persistence.saveState(state)
    scheduleSync()
  }

  function scheduleSync() {
    // 阶段 2 接入 sync 服务（乐观锁 + 409 合并重试）；
    // sync 服务注册钩子后接管。
    if (typeof _syncHook === 'function') _syncHook()
  }

  // —— 访问器（同 legacy state.js） ——
  function getCh() { return state.chapters[state.currentChapterId] || null }
  function getSubj() { return state.subjects[state.currentSubjectId] || null }
  function getExam() { return state.generatedExams[state.currentExamId] || null }

  function getActiveSet() {
    const ex = getExam()
    if (ex) return {
      _ref: ex, questions: ex.questions, userAnswers: ex.userAnswers,
      currentIdx: ex.currentIdx, setCurrentIdx: (v) => { ex.currentIdx = v },
      setName: ex.name, isExam: true, setId: ex.id, subjectId: ex.subjectId
    }
    const ch = getCh()
    if (!ch) return null
    if (ch.quizSets && ch.quizSets.length > 0) {
      const idx = (typeof ch.currentQuizSetIdx === 'number' && ch.currentQuizSetIdx >= 0) ? ch.currentQuizSetIdx : ch.quizSets.length - 1
      const qs = ch.quizSets[idx]
      return {
        _ref: qs, _isSet: true, questions: qs.questions, userAnswers: qs.userAnswers,
        currentIdx: qs.currentIdx, setCurrentIdx: (v) => { qs.currentIdx = v },
        setName: ch.name, isExam: false, setId: ch.id, subjectId: null
      }
    }
    return {
      _ref: ch, questions: ch.questions, userAnswers: ch.userAnswers,
      currentIdx: ch.currentIdx, setCurrentIdx: (v) => { ch.currentIdx = v },
      setName: ch.name, isExam: false, setId: ch.id, subjectId: null
    }
  }

  function getCurrentQuizSet() {
    const ch = getCh()
    if (!ch || !ch.quizSets || ch.quizSets.length === 0) return null
    const idx = (typeof ch.currentQuizSetIdx === 'number' && ch.currentQuizSetIdx >= 0) ? ch.currentQuizSetIdx : ch.quizSets.length - 1
    return ch.quizSets[idx]
  }

  function getChStrategy(cid) { return persistence.getChStrategy(state, cid) }

  function createQuizSetForChapter(questions, chId) {
    const ch = state.chapters[chId]
    if (!ch) return null
    if (!ch.quizSets) ch.quizSets = []
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
    state, saveState,
    getCh, getSubj, getExam, getActiveSet, getCurrentQuizSet,
    getChStrategy, createQuizSetForChapter
  }
})
