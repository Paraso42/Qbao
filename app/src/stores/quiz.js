// ============================================================
// quiz store — 答题引擎编排（自 legacy quiz-engine/quiz-report 迁移）
// 负责：答题会话状态、答案提交、结算（历史/成就/服务端同步）、
//       大考卷的答题入口、报告数据准备。
// ============================================================
import { defineStore } from 'pinia'
import { computed, reactive } from 'vue'
import { useDataStore } from './data'
import { useUserStore } from './user'
import { useUiStore } from './ui'
import { usePointsStore } from './points'
import { fetchWithAuth } from '../services/api'
import {
  calcStats, syncSingleAnswerToTagMeta, autoUpdateChapterWeakTags,
  rebuildChapterAnswersFromSets
} from '../services/questions'
import { saveQuizHistory } from '../services/history'
import { checkAchievements } from '../services/achievements'

let _lastSyncTime = 0
let _syncPendingTimer = null
let _firstSyncDone = false
let _lifecycleBound = false

export const useQuizStore = defineStore('quiz', () => {
  const data = useDataStore()
  const user = useUserStore()
  const ui = useUiStore()
  const points = usePointsStore()

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
  function syncAnswerToServer(opts) {
    if (!user.isOnline || !user.token) return
    const keepalive = !!(opts && opts.keepalive)
    const now = Date.now()
    if (!_firstSyncDone) {
      _firstSyncDone = true
    } else if (now - _lastSyncTime < 5000) {
      if (_syncPendingTimer) clearTimeout(_syncPendingTimer)
      _syncPendingTimer = setTimeout(() => syncAnswerToServer(opts), 5000 - (now - _lastSyncTime))
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
      keepalive,
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
    })
      // 结算（completed）响应带最新余额 → 实时同步积分显示
      .then((res) => (res && res.ok ? res.json().catch(() => null) : null))
      .then((d) => {
        if (d && typeof d.balance === 'number') points.applyBalance(d.balance)
        // 已答全部题目且服务端确认完成 → 标记本轮已结算（供补结算钩子跳过）
        if (syncStatus === 'completed' && d && d.session && as._ref) as._ref._serverCompleted = true
      })
      .catch((e) => console.warn('syncAnswerToServer failed:', e))
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
    })
      // 结算响应带最新余额 → 实时同步积分显示
      .then((res) => (res && res.ok ? res.json().catch(() => null) : null))
      .then((d) => {
        if (d && typeof d.balance === 'number') points.applyBalance(d.balance)
        if (d && d.session && as._ref) as._ref._serverCompleted = true
      })
      .catch((e) => console.warn('syncAnswerToServerFinal failed:', e))
  }

  function flushBeforeUnload() {
    if (_syncPendingTimer) { clearTimeout(_syncPendingTimer); _syncPendingTimer = null }
    _firstSyncDone = true
    _lastSyncTime = 0
    // keepalive：页面销毁期间请求不被浏览器取消，尽力把当前进度/完成态送到服务端
    syncAnswerToServer({ keepalive: true })
  }

  // 本轮题目已全部作答但尚未收到服务端“completed”确认（离线作答、
  // 结算请求中断、刷新打断等）→ 补发一次最终结算，避免服务端 in_progress
  // 残留导致“开始出题”被 409 锁死；服务端按增量结算，重复发送幂等。
  let _lastEnsureAt = 0
  function ensureActiveSetCompleted() {
    if (!user.isOnline || !user.token) return
    const as = activeSet.value
    if (!as || !as.questions || !as.questions.length) return
    if (as._ref && as._ref._serverCompleted) return
    const answered = (as.userAnswers || []).filter((a) => a !== undefined && a !== null && a !== -1).length
    if (answered < as.questions.length) return
    syncAnswerToServerFinal()
  }

  function bindLifecycle() {
    if (_lifecycleBound) return
    _lifecycleBound = true
    window.addEventListener('beforeunload', flushBeforeUnload)
    // 回到页面/恢复在线：本地已全答完但未收到结算确认 → 自动补结算
    window.addEventListener('online', () => {
      if (Date.now() - _lastEnsureAt < 15000) return
      _lastEnsureAt = Date.now()
      ensureActiveSetCompleted()
    })
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') { flushBeforeUnload(); return }
      if (Date.now() - _lastEnsureAt < 15000) return
      _lastEnsureAt = Date.now()
      ensureActiveSetCompleted()
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
    if (srvQs.length === 0) {
      // 空题会话：无实际题目却占着 in_progress，自动清理，避免"有未做完却进不去答题界面"（K3）
      fetchWithAuth('/quiz/session/' + sessionMeta.id, { method: 'DELETE' }).catch(() => {})
      ui.toast('发现空答题会话，已自动清理', 'info')
      return
    }

    const ch = data.state.chapters[sessionMeta.chapterId]
    if (!ch) return
    if (!ch.quizSets) ch.quizSets = []

    let matchingSet = null
    for (let si = ch.quizSets.length - 1; si >= 0; si--) {
      const qs = ch.quizSets[si]
      if (qs && qs.questions && qs.questions.length === srvQs.length) {
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
      // 服务端会话并入本地题库（按题干去重补漏），绝不整体覆盖——多端合并时
      // 本地题库可能比服务端会话更大更全，覆盖即丢题
      if (!Array.isArray(ch.questions)) ch.questions = []
      const have = new Set(ch.questions.map((q) => (q && q.question) || null))
      srvQs.forEach((q) => {
        if (q && q.question && !have.has(q.question)) { have.add(q.question); ch.questions.push(q) }
      })
      if (!Array.isArray(ch.userAnswers)) ch.userAnswers = []
      rebuildChapterAnswersFromSets(ch)
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
      if (qs && qs.questions && qs.questions.length > 0) {
        const answered = qs.userAnswers ? qs.userAnswers.filter((a) => a !== undefined && a !== null && a !== -1).length : 0
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
    // 已结束的大考卷：报告关闭后清掉 currentExamId（残留会遮蔽章节轮次的答题上下文）；
    // 未结束的考卷（答到一半关闭）保留以便续答
    if (session.endedFromExam && data.state.currentExamId) {
      data.state.currentExamId = null
      session.endedFromExam = false
      data.saveState()
    }
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
    if (as._ref) { delete as._ref._finalized; delete as._ref._serverCompleted }
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
    if (!as._isSet || !ch || !ch.quizSets) return
    // 多端合并后题库可能经过去重（ch.questions 与各轮拼接不同序不同长），
    // 逐位置偏移写入会串题；改为按题干把各轮答案重新对齐到题库
    rebuildChapterAnswersFromSets(ch)
  }

  function endExam() {
    const as = activeSet.value
    if (!as) return
    // 双击“查看报告/结束”防重：本轮只结算一次，避免重复历史记录/重复请求
    if (isSetFinalized(as)) { openQuiz('report'); return }
    if (as._isSet) { endQuizSessionForSet(as); return }
    if (as.isExam) { endExamGenerated(); return }
    // 兼容旧数据路径
    autoUpdateChapterWeakTags(data.state, as._ref, as)
    saveQuizHistory(data.state, as)
    checkAchievements(data.state)
    syncAnswerToServerFinal()
    data.saveState()
    session.endedFromExam = false
    markSetFinalized(as)
    openQuiz('report')
  }

  function isSetFinalized(as) { return !!(as && as._ref && as._ref._finalized) }
  function markSetFinalized(as) { if (as && as._ref) as._ref._finalized = true }

  function endQuizSessionForSet(as) {
    // 检测流式任务是否仍在运行
    const streamStillRunning = (data.state.aiTaskQueue || []).some((t) => t.streamSetRef === as._ref && t.status === 'running')
    const ch = data.getCh()

    if (streamStillRunning) {
      const answeredCopy = { questions: as.questions.slice(), userAnswers: as.userAnswers.slice() }
      finalizeUnanswered(answeredCopy)
      syncSetAnswersToChapter(ch, as)
      saveQuizHistory(data.state, answeredCopy)
      if (answeredCopy.setId) autoUpdateChapterWeakTags(data.state, data.state.chapters[answeredCopy.setId])
      checkAchievements(data.state)
      syncAnswerToServerFinal()
      data.saveState()
      markSetFinalized(as)
      openQuiz('report')
      return
    }
    syncSetAnswersToChapter(ch, as)
    finalizeUnanswered(as)
    saveQuizHistory(data.state, as)
    if (as.setId) autoUpdateChapterWeakTags(data.state, data.state.chapters[as.setId])
    checkAchievements(data.state)
    syncAnswerToServerFinal()
    data.saveState()
    session.endedFromExam = false
    markSetFinalized(as)
    openQuiz('report')
  }

  function endExamGenerated() {
    const as = activeSet.value
    if (!as) return
    checkAchievements(data.state)
    syncAnswerToServerFinal()
    // 关键：报告视图的 activeSet 依赖 currentExamId 指向本考卷——
    // 此处若清空，报告会回落到“当前章节的轮次”，出现题目对不上的错报（B1）。
    // 上下文保留到报告关闭时由 closeQuiz 清理。
    session.endedFromExam = true
    data.saveState()
    openQuiz('report')
  }

  // —— 大考卷入口 ——
  function startExam(examId) {
    const ex = data.state.generatedExams[examId]
    if (!ex) return
    data.state.currentExamId = examId
    session.endedFromExam = false
    data.saveState()
    openQuiz('quiz')
  }

  // 已结束考卷的「查看报告」入口：activeSet 指向该考卷并直接进入报告视图
  function openExamReport(examId) {
    const ex = data.state.generatedExams[examId]
    if (!ex) return
    data.state.currentExamId = examId
    session.endedFromExam = true
    data.saveState()
    openQuiz('report')
  }

  return {
    session,
    activeSet, currentQuestion, currentAnswer, hasAnswer, stats,
    openQuiz, closeQuiz,
    startSession, selectOption, submitAnswer, nextQuestion, goToQuestion,
    markDontKnow, resetQuiz, endExam,
    startExam, openExamReport,
    restoreQuizFromServer, syncAnswerToServer, syncAnswerToServerFinal,
    ensureActiveSetCompleted,
    bindLifecycle
  }
})