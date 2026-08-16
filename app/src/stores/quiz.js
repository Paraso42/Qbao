// ============================================================
// quiz store — 答题引擎编排（自 legacy quiz-engine/srs/quiz-report 迁移）
// 负责：答题会话状态、答案提交、结算（历史/SRS/成就/服务端同步）、
//       SRS 复习与大考卷的答题入口、报告数据准备。
// ============================================================
import { defineStore } from 'pinia'
import { computed, reactive } from 'vue'
import { useDataStore } from './data'
import { useUserStore } from './user'
import { useUiStore } from './ui'
import { fetchWithAuth } from '../services/api'
import {
  calcStats, syncSingleAnswerToTagMeta, autoUpdateChapterWeakTags,
  getQuestionId, isQuestionIgnored
} from '../services/questions'
import { saveQuizHistory } from '../services/history'
import { updateSRSAfterExam, buildSrsExam } from '../services/srs'
import { checkAchievements } from '../services/achievements'

let _lastSyncTime = 0
let _syncPendingTimer = null
let _firstSyncDone = false
let _lifecycleBound = false

export const useQuizStore = defineStore('quiz', () => {
  const data = useDataStore()
  const user = useUserStore()
  const ui = useUiStore()

  const session = reactive({
    modalOpen: false,
    view: 'quiz', // quiz | report
    wrongOnly: false,
    endedFromExam: false
  })

  const activeSet = computed(() => data.getActiveSet())
  const currentQuestion = computed(() => {
    const as = activeSet.value
    if (!as || !as.questions || !as.questions.length) return null
    const idx = Math.max(0, Math.min(as.currentIdx, as.questions.length - 1))
    return as.questions[idx] || null
  })
  const currentAnswer = computed(() => {
    const as = activeSet.value
    if (!as) return undefined
    return as.userAnswers ? as.userAnswers[as.currentIdx] : undefined
  })
  const hasAnswer = computed(() => {
    const a = currentAnswer.value
    return a !== undefined && a !== -1 && a !== null
  })
  const stats = computed(() => calcStats(activeSet.value))

  // —— 服务端答题会话同步（节流 5s，语义同 legacy） ——
  function syncAnswerToServer() {
    if (!user.isOnline || !user.token) return
    const now = Date.now()
    if (!_firstSyncDone) {
      _firstSyncDone = true
    } else if (now - _lastSyncTime < 5000) {
      if (_syncPendingTimer) clearTimeout(_syncPendingTimer)
      _syncPendingTimer = setTimeout(syncAnswerToServer, 5000 - (now - _lastSyncTime))
      return
    }
    _lastSyncTime = now
    const as = activeSet.value
    if (!as || !as.questions || !as.questions.length) return
    const ch = data.getCh()
    const chapterId = as.setId || (ch ? ch.id : null)
    if (!chapterId) return
    const subj = data.getSubj()
    const subjectId = as.subjectId || (subj ? subj.id : null)
    const statsNow = calcStats(as)
    const syncAnswers = as.userAnswers.map((a) => (a === -1 || a === null) ? undefined : a)
    const answered = syncAnswers.filter((a) => a !== undefined).length
    const syncStatus = (answered >= as.questions.length) ? 'completed' : 'in_progress'
    fetchWithAuth('/quiz/session', {
      method: 'POST',
      body: JSON.stringify({
        chapterId,
        subjectId,
        setId: as.setId,
        sessionName: as.setName || (ch ? ch.name : ''),
        questions: as.questions,
        userAnswers: syncAnswers,
        stats: statsNow,
        status: syncStatus
      })
    }).catch((e) => console.warn('syncAnswerToServer failed:', e))
  }

  function syncAnswerToServerFinal() {
    if (!user.isOnline || !user.token) return
    if (_syncPendingTimer) { clearTimeout(_syncPendingTimer); _syncPendingTimer = null }
    _lastSyncTime = 0
    _firstSyncDone = false
    const as = activeSet.value
    if (!as || !as.questions || !as.questions.length) return
    const ch = data.getCh()
    const chapterId = as.setId || (ch ? ch.id : null)
    if (!chapterId) return
    const subj = data.getSubj()
    const subjectId = as.subjectId || (subj ? subj.id : null)
    fetchWithAuth('/quiz/session', {
      method: 'POST',
      body: JSON.stringify({
        chapterId,
        subjectId,
        setId: as.setId,
        sessionName: as.setName || (ch ? ch.name : ''),
        questions: as.questions,
        userAnswers: as.userAnswers,
        stats: calcStats(as),
        status: 'completed'
      })
    }).catch((e) => console.warn('syncAnswerToServerFinal failed:', e))
  }

  function flushBeforeUnload() {
    if (_syncPendingTimer) { clearTimeout(_syncPendingTimer); _syncPendingTimer = null }
    _firstSyncDone = true
    _lastSyncTime = 0
    syncAnswerToServer()
  }

  function bindLifecycle() {
    if (_lifecycleBound) return
    _lifecycleBound = true
    window.addEventListener('beforeunload', flushBeforeUnload)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushBeforeUnload()
    })
  }

  // —— 服务端恢复（语义同 legacy restoreQuizFromServer/_restoreOneSession） ——
  async function restoreQuizFromServer(restoreAll) {
    if (!user.isOnline || !user.token) return
    try {
      const sRes = await fetchWithAuth('/quiz/sessions?status=in_progress')
      if (!sRes || !sRes.ok) return
      const sData = await sRes.json()
      const sessions = sData.sessions || []
      if (sessions.length === 0) return
      if (restoreAll) {
        for (const sess of sessions) await restoreOneSession(sess)
      } else {
        const as = activeSet.value
        const ch = data.getCh()
        const chapterId = as ? (as.setId || (ch ? ch.id : null)) : (ch ? ch.id : null)
        if (!chapterId) return
        for (const sess of sessions) {
          if (sess.chapterId === chapterId) { await restoreOneSession(sess); break }
        }
      }
    } catch (e) { console.warn('restoreQuizFromServer failed:', e) }
  }

  async function restoreOneSession(sessionMeta) {
    const dRes = await fetchWithAuth('/quiz/session/' + sessionMeta.id)
    if (!dRes || !dRes.ok) return
    const dData = await dRes.json()
    const srv = dData.session
    if (!srv || !srv.userAnswers || !Array.isArray(srv.userAnswers)) return
    const srvQs = srv.questions || []
    if (srvQs.length === 0) return

    const ch = data.state.chapters[sessionMeta.chapterId]
    if (!ch) return
    if (!ch.quizSets) ch.quizSets = []

    let matchingSet = null
    for (let si = ch.quizSets.length - 1; si >= 0; si--) {
      const qs = ch.quizSets[si]
      if (qs.questions.length === srvQs.length) {
        if (qs.questions[0] && srvQs[0] && qs.questions[0].question === srvQs[0].question) {
          matchingSet = qs
          break
        }
      }
    }

    if (matchingSet) {
      for (let j = 0; j < matchingSet.userAnswers.length && j < srv.userAnswers.length; j++) {
        const srvAns = srv.userAnswers[j]
        if (srvAns !== -1 && srvAns !== null && srvAns !== undefined) {
          const localAns = matchingSet.userAnswers[j]
          if (localAns === undefined || localAns === -1 || localAns === null) matchingSet.userAnswers[j] = srvAns
        }
        if (matchingSet.userAnswers[j] === null) matchingSet.userAnswers[j] = undefined
      }
      const idx = ch.quizSets.indexOf(matchingSet)
      if (ch.currentQuizSetIdx !== idx) ch.currentQuizSetIdx = idx
    } else {
      const cleanAnswers = srv.userAnswers.map((a) => (a === null ? undefined : a))
      const newSet = { questions: srvQs.slice(), userAnswers: cleanAnswers, currentIdx: 0, createdAt: Date.now() }
      ch.quizSets.push(newSet)
      ch.currentQuizSetIdx = ch.quizSets.length - 1
      if (!ch.questions) ch.questions = []
      ch.questions = srvQs.slice()
      if (!ch.userAnswers) ch.userAnswers = []
      ch.userAnswers = cleanAnswers
    }
    data.saveState()
  }

  // —— 答题流程 ——
  function startSession() {
    _firstSyncDone = false
    const ch = data.getCh()
    if (!ch) return
    // 检测当前章节是否有正在流式注入的任务
    const runningStreamTask = (data.state.aiTaskQueue || []).find((t) => t.chapterId === ch.id && t.status === 'running')
    if (runningStreamTask && runningStreamTask.streamSetRef) {
      ch.currentQuizSetIdx = ch.quizSets.indexOf(runningStreamTask.streamSetRef)
      data.saveState()
      openQuiz('quiz')
      return
    }
    if (ch.quizSets && ch.quizSets.length > 0) {
      const qs = data.getCurrentQuizSet()
      if (qs && qs.questions.length > 0) {
        const answered = qs.userAnswers ? qs.userAnswers.filter((a) => a !== undefined && a !== -1).length : 0
        if (answered >= qs.questions.length && qs.questions.length > 0) { endExam(); return }
        if (answered === 0 && qs.userAnswers) {
          qs.userAnswers = new Array(qs.questions.length).fill(undefined)
          qs.currentIdx = 0
          data.saveState()
        }
        if (answered > 0 && answered < qs.questions.length && qs.userAnswers) {
          for (let j = 0; j < qs.userAnswers.length; j++) {
            if (qs.userAnswers[j] === -1 || qs.userAnswers[j] === null) qs.userAnswers[j] = undefined
          }
          data.saveState()
        }
        // 初始化/重置本轮标签统计
        const s = data.getChStrategy(ch.id)
        if (s) {
          s._roundTagStats = {}
          qs.questions.forEach((q) => {
            if (!q.tag) return
            if (!s._roundTagStats[q.tag]) s._roundTagStats[q.tag] = { correct: 0, wrong: 0, total: 0 }
            s._roundTagStats[q.tag].total++
          })
          if (qs._tagSynced) {
            for (let k = 0; k < qs._tagSynced.length; k++) {
              if (qs.userAnswers[k] === undefined) qs._tagSynced[k] = false
            }
          }
        }
        openQuiz('quiz')
        return
      }
    }
    if (ch.questions && ch.questions.length > 0) { openQuiz('quiz'); return }
    ui.toast('暂无题目', 'info')
  }

  function openQuiz(view) {
    session.modalOpen = true
    session.view = view || 'quiz'
  }
  function closeQuiz() {
    session.modalOpen = false
    session.wrongOnly = false
  }

  function selectOption(idx) {
    const as = activeSet.value
    if (!as || (as.userAnswers[as.currentIdx] !== undefined && as.userAnswers[as.currentIdx] !== null)) return
    as.userAnswers[as.currentIdx] = idx
    const ch = data.getCh()
    if (ch && as._isSet) {
      if (!as._tagSynced) as._tagSynced = []
      if (!as._tagSynced[as.currentIdx]) {
        syncSingleAnswerToTagMeta(data.state, ch.id, as.questions[as.currentIdx], idx)
        as._tagSynced[as.currentIdx] = true
      }
    }
    data.saveState()
    syncAnswerToServer()
  }

  function submitAnswer(subjectiveText) {
    const as = activeSet.value
    if (!as || !as.questions || !as.questions.length) return
    const q = as.questions[as.currentIdx]
    if (!q || (as.userAnswers[as.currentIdx] !== undefined && as.userAnswers[as.currentIdx] !== null)) return
    if (q.type === 'term' || q.type === 'short') {
      const text = String(subjectiveText || '').trim()
      if (!text) { ui.toast('请输入答案', 'err'); return }
      as.userAnswers[as.currentIdx] = text
    } else {
      if (as.userAnswers[as.currentIdx] === undefined) { ui.toast('请选择选项', 'err'); return }
    }
    const ch = data.getCh()
    if (ch && as._isSet && as.userAnswers[as.currentIdx] !== undefined && as.userAnswers[as.currentIdx] !== null) {
      if (!as._tagSynced) as._tagSynced = []
      if (!as._tagSynced[as.currentIdx]) {
        syncSingleAnswerToTagMeta(data.state, ch.id, as.questions[as.currentIdx], as.userAnswers[as.currentIdx])
        as._tagSynced[as.currentIdx] = true
      }
    }
    data.saveState()
    checkAchievements(data.state)
    syncAnswerToServer()
  }

  function nextQuestion() {
    const as = activeSet.value
    if (!as) return
    if (as.currentIdx < as.questions.length - 1) {
      as.setCurrentIdx(as.currentIdx + 1)
      data.saveState()
    }
  }

  function goToQuestion(idx) {
    const as = activeSet.value
    if (!as || idx < 0 || idx >= as.questions.length) return
    as.setCurrentIdx(idx)
    data.saveState()
  }

  function ignoreCurrent() {
    const as = activeSet.value
    if (!as) return
    const q = as.questions[as.currentIdx]
    if (!q) return
    if (!data.state.ignoredQuestions) data.state.ignoredQuestions = []
    const qId = getQuestionId(as.setId, q)
    if (!data.state.ignoredQuestions.includes(qId)) data.state.ignoredQuestions.push(qId)
    if (q.type === 'single' || q.type === 'judge') as.userAnswers[as.currentIdx] = q.answer
    else as.userAnswers[as.currentIdx] = '(已掌握)'
    if (as.currentIdx < as.questions.length - 1) as.setCurrentIdx(as.currentIdx + 1)
    data.saveState()
  }

  function markDontKnow() {
    const as = activeSet.value
    if (!as) return
    const q = as.questions[as.currentIdx]
    if (!q || (q.type !== 'single' && q.type !== 'judge')) return
    let wrongIdx = -1
    if (q.options && Array.isArray(q.options)) {
      for (let i = 0; i < q.options.length; i++) {
        if (i !== q.answer) { wrongIdx = i; break }
      }
    }
    if (wrongIdx === -1) return
    as.userAnswers[as.currentIdx] = wrongIdx
    const ch = data.getCh()
    if (ch && as._isSet) {
      if (!as._tagSynced) as._tagSynced = []
      if (!as._tagSynced[as.currentIdx]) {
        syncSingleAnswerToTagMeta(data.state, ch.id, q, wrongIdx)
        as._tagSynced[as.currentIdx] = true
      }
    }
    data.saveState()
    syncAnswerToServer()
  }

  function resetQuiz() {
    const as = activeSet.value
    if (!as) return
    as.userAnswers = new Array(as.questions.length).fill(undefined)
    as.setCurrentIdx(0)
    data.saveState()
    if (as._isSet) { openQuiz('quiz'); return }
    closeQuiz()
  }

  function finalizeUnanswered(as) {
    if (!as || !as.questions || !as.userAnswers) return
    for (let i = 0; i < as.questions.length; i++) {
      if (as.userAnswers[i] === undefined) as.userAnswers[i] = -1
    }
  }

  function syncSetAnswersToChapter(ch, as) {
    if (!as._isSet || !ch || !ch.quizSets || !ch.userAnswers) return
    const qsIdx = ch.currentQuizSetIdx
    if (qsIdx >= 0 && qsIdx < ch.quizSets.length) {
      let offset = 0
      for (let s = 0; s < qsIdx; s++) offset += ch.quizSets[s].questions.length
      const qsA = ch.quizSets[qsIdx].userAnswers
      for (let a = 0; a < qsA.length && (offset + a) < ch.userAnswers.length; a++) {
        if (qsA[a] !== undefined && qsA[a] !== null) ch.userAnswers[offset + a] = qsA[a]
      }
    }
  }

  function endExam() {
    const as = activeSet.value
    if (!as) return
    if (as._isSet) { endQuizSessionForSet(as); return }
    if (as.isExam) { endExamGenerated(as); return }
    // 兼容旧数据路径
    autoUpdateChapterWeakTags(data.state, as._ref, as)
    saveQuizHistory(data.state, as)
    updateSRSAfterExam(data.state, as)
    checkAchievements(data.state)
    syncAnswerToServerFinal()
    data.saveState()
    session.endedFromExam = false
    openQuiz('report')
  }

  function endQuizSessionForSet(as) {
    // 检测流式任务是否仍在运行
    const streamStillRunning = (data.state.aiTaskQueue || []).some((t) => t.streamSetRef === as._ref && t.status === 'running')
    const ch = data.getCh()

    if (streamStillRunning) {
      const answeredCopy = { questions: as.questions.slice(), userAnswers: as.userAnswers.slice() }
      finalizeUnanswered(answeredCopy)
      syncSetAnswersToChapter(ch, as)
      saveQuizHistory(data.state, answeredCopy)
      updateSRSAfterExam(data.state, answeredCopy)
      if (answeredCopy.setId) autoUpdateChapterWeakTags(data.state, data.state.chapters[answeredCopy.setId])
      checkAchievements(data.state)
      syncAnswerToServerFinal()
      data.saveState()
      openQuiz('report')
      return
    }
    syncSetAnswersToChapter(ch, as)
    finalizeUnanswered(as)
    saveQuizHistory(data.state, as)
    updateSRSAfterExam(data.state, as)
    if (as.setId) autoUpdateChapterWeakTags(data.state, data.state.chapters[as.setId])
    checkAchievements(data.state)
    syncAnswerToServerFinal()
    data.saveState()
    session.endedFromExam = false
    openQuiz('report')
  }

  function endExamGenerated(as) {
    updateSRSAfterExam(data.state, as)
    checkAchievements(data.state)
    syncAnswerToServerFinal()
    data.state.currentExamId = null
    if (as.questions && as.questions.length > 0) {
      let taggedChapterId = null
      as.questions.forEach((q) => { if (q._srsChapterId && !taggedChapterId) taggedChapterId = q._srsChapterId })
      if (taggedChapterId && data.state.chapters[taggedChapterId]) {
        autoUpdateChapterWeakTags(data.state, data.state.chapters[taggedChapterId])
      }
    }
    data.saveState()
    session.endedFromExam = true
    openQuiz('report')
  }

  // —— SRS / 大考卷入口 ——
  function startSrsReview() {
    const eid = buildSrsExam(data.state)
    if (!eid) { ui.toast('暂无待复习题目', 'info'); return }
    data.saveState()
    openQuiz('quiz')
  }

  function startExam(examId) {
    const ex = data.state.generatedExams[examId]
    if (!ex) return
    data.state.currentExamId = examId
    data.saveState()
    openQuiz('quiz')
  }

  function isIgnored(q) {
    const as = activeSet.value
    return as ? isQuestionIgnored(data.state, as.setId, q) : false
  }

  return {
    session,
    activeSet, currentQuestion, currentAnswer, hasAnswer, stats,
    openQuiz, closeQuiz,
    startSession, selectOption, submitAnswer, nextQuestion, goToQuestion,
    ignoreCurrent, markDontKnow, resetQuiz, endExam,
    startSrsReview, startExam,
    restoreQuizFromServer, syncAnswerToServer, syncAnswerToServerFinal,
    bindLifecycle, isIgnored
  }
})
