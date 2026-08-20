// ============================================================
// ai store — AI 出题编排（自 legacy ai-workflow.js 迁移 + v3.27 服务端任务队列补全）
// 三条生成路径：流式 SSE / 非流式 JSON / 服务端后台任务
// ============================================================
import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import { useDataStore } from './data'
import { useUserStore } from './user'
import { useUiStore } from './ui'
import {
  fetchProvidersList, aiTest, aiUploadFiles, aiStreamGenerate,
  createAiServerTask, getAiServerTask, listAiServerTasks, cancelAiServerTask
} from '../services/aiApi'
import { getAiApiKey, setAiApiKey, removeAiApiKey, hasAnyAiApiKey } from '../services/aiKeys'
import { generatePromptText } from '../services/strategy'
import { idbGetMaterial, idbStoreMaterial, idbDeleteMaterial } from '../services/materialsDb'
import { generateMaterialId, formatFileSize, sleep, fetchWithRetry, getCi } from '../services/utils'
import { API_BASE } from '../core/env'
import { getToken, fetchWithAuth } from '../services/api'

const MAX_ATTEMPTS = 3

export const useAiStore = defineStore('ai', () => {
  const data = useDataStore()
  const user = useUserStore()
  const ui = useUiStore()

  const providers = ref([])
  const providersLoaded = ref(false)
  const runnerActive = ref(false)
  const abortController = ref(null)
  const queueDialogOpen = ref(false)
  const serverTasks = ref([])
  const serverTasksLoading = ref(false)
  const serverPollTimer = ref(null)

  const aiConfig = computed(() => data.state.aiConfig || {})

  // —— 资料管理（chapterMaterials，二进制存 IndexedDB） ——
  function getChapterMaterials(cid) {
    if (!data.state.chapterMaterials) data.state.chapterMaterials = {}
    return data.state.chapterMaterials[cid] || []
  }
  function saveChapterMaterials(cid, materials) {
    if (!data.state.chapterMaterials) data.state.chapterMaterials = {}
    data.state.chapterMaterials[cid] = materials
    data.saveState()
  }

  // —— Provider 目录 ——
  const providersError = ref('')
  async function ensureProviders(force = false) {
    if (providersLoaded.value && !force) return providers.value
    try {
      providers.value = await fetchProvidersList()
      providersError.value = ''
    } catch (e) {
      providers.value = []
      providersError.value = (e && e.message) || '无法连接 AI 服务'
      console.warn('[ai] fetchProviders failed:', e && e.message)
    } finally {
      providersLoaded.value = true
    }
    return providers.value
  }

  function getProvider(id) {
    return providers.value.find((p) => p.id === id) || null
  }
  function defaultModelFor(providerId) {
    const p = getProvider(providerId)
    if (p && p.models && p.models.length > 0) return p.models[0].id
    return 'ecnu-plus'
  }
  function rememberModel(providerId, modelId) {
    if (!data.state.aiConfig.modelByProvider) data.state.aiConfig.modelByProvider = {}
    data.state.aiConfig.modelByProvider[providerId] = modelId
    data.saveState()
  }
  function recalledModel(providerId) {
    const map = data.state.aiConfig.modelByProvider || {}
    return map[providerId] || defaultModelFor(providerId)
  }
  function effectiveModel() {
    const ac = aiConfig.value
    const provider = ac.provider || 'ecnu'
    const remembered = (data.state.aiConfig.modelByProvider || {})[provider]
    if (remembered) return remembered
    if (ac.model) return ac.model
    return defaultModelFor(provider)
  }

  // —— AI 配置保存/测试 ——
  function saveAiConfig({ provider, model, apiKey, systemPrompt, selfCheck, useServerQueue, taskInterval }) {
    const ac = data.state.aiConfig
    if (!ac) data.state.aiConfig = {}
    const cfg = data.state.aiConfig
    if (provider) {
      cfg.provider = provider
      if (model) rememberModel(provider, model)
      cfg.model = model || effectiveModel()
    }
    if (typeof apiKey === 'string' && apiKey.trim()) {
      setAiApiKey(cfg.provider || 'ecnu', apiKey.trim())
    }
    cfg.apiKeySet = hasAnyAiApiKey()
    if (typeof systemPrompt === 'string') cfg.systemPrompt = systemPrompt
    if (typeof selfCheck === 'boolean') cfg.selfCheck = selfCheck
    if (typeof useServerQueue === 'boolean') cfg.useServerQueue = useServerQueue
    if (typeof taskInterval === 'number') cfg.taskInterval = taskInterval
    // v3.30.1：流式输出暂时停用（见 executeTask 注释）；不再强制开启
    // cfg.streamMode = true
    data.saveState()
  }

  function clearApiKey(providerId) {
    removeAiApiKey(providerId)
    data.state.aiConfig.apiKeySet = hasAnyAiApiKey()
    data.saveState()
  }

  async function testConnection() {
    const ac = aiConfig.value
    const provider = ac.provider || 'ecnu'
    const apiKey = getAiApiKey(provider)
    if (!apiKey) throw new Error('请先保存 API 密钥')
    const model = effectiveModel()
    const res = await aiTest({ apiKey, provider, model, message: 'ping' })
    return { ...res, provider, model }
  }

  // —— 任务队列 ——
  function hasTaskForChapter(chapterId) {
    return (data.state.aiTaskQueue || []).some((t) => t.chapterId === chapterId && (t.status === 'pending' || t.status === 'running'))
  }

  // 章节最近一轮是否还有未做完的题目（K1 规则本地前置校验；服务端有 409 兜底）
  function hasUnfinishedQuestions(ch) {
    if (!ch || !ch.quizSets || ch.quizSets.length === 0) return false
    const qs = ch.quizSets[ch.quizSets.length - 1]
    if (!qs || !qs.questions || qs.questions.length === 0) return false
    const unanswered = (qs.userAnswers || [])
      .filter((a) => a === undefined || a === null || a === -1).length
    return unanswered > 0
  }

  function enqueueGenerate(chapterId, typeCounts) {
    const ch = data.state.chapters[chapterId]
    if (!ch) { ui.toast('章节不存在', 'err'); return }
    const materials = getChapterMaterials(chapterId)
    if (!materials.length) { ui.toast('请先上传复习资料', 'err'); return }
    if (!user.isOnline || !user.token) { ui.toast('请先登录', 'err'); return }
    if (hasTaskForChapter(chapterId)) { ui.toast('该章节已在队列中', 'info'); return }
    if (hasUnfinishedQuestions(ch)) { ui.toast('本章节还有未做完的题目，请先完成本轮答题', 'err'); return }

    const strategy = data.getChStrategy(chapterId)
    if (strategy && typeCounts) {
      strategy.typeCounts = { ...typeCounts }
      data.saveState()
    }
    const totalQ = (typeCounts ? typeCounts.single + typeCounts.judge + typeCounts.term + typeCounts.short : 0)
    if (totalQ === 0) { ui.toast('请至少设置一道题目的数量', 'err'); return }

    const task = {
      id: 'task_' + Date.now() + '_' + Math.random().toString(36).substr(2),
      chapterId,
      chapterName: ch.name,
      status: 'pending',
      promptText: generatePromptText(data.state, chapterId),
      materialNames: materials.map((m) => m.name),
      strategySnapshot: strategy ? JSON.parse(JSON.stringify(strategy)) : null,
      createdAt: Date.now(),
      completedAt: null,
      questionCount: 0,
      error: '',
      streamQuestionCount: 0,
      streamSetRef: null,
      _expectedTotal: totalQ
    }
    data.state.aiTaskQueue.push(task)
    data.saveState()
    if (!runnerActive.value) {
      runnerActive.value = true
      runnerLoop()
    }
    const position = data.state.aiTaskQueue.filter((t) => t.status === 'pending').length
    ui.toast(ch.name + ' 已加入队列，排在第 ' + position + ' 位', 'info')
  }

  async function runnerLoop() {
    while (runnerActive.value) {
      const pendingTask = data.state.aiTaskQueue.find((t) => t.status === 'pending')
      if (!pendingTask) { runnerActive.value = false; return }
      await executeTask(pendingTask)
      if (!runnerActive.value) return
      await sleep(100)
    }
  }

  // —— 章节历史统计（供 chapterHistory 入参） ——
  function collectChapterHistory(chapterId) {
    const ch = data.state.chapters[chapterId]
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

  // —— 本地资料上传解析 ——
  async function prepareUploadData(task) {
    const materials = getChapterMaterials(task.chapterId)
    const localMaterials = materials.filter((m) => !m._poolFile)
    const files = []
    for (const m of localMaterials) {
      const dataUrl = await idbGetMaterial(m.id)
      if (!dataUrl) {
        if (task.log) task.log.push('资料 ' + m.name + ' 本地无缓存，将在服务端读取')
        continue
      }
      const dec = atob(dataUrl.split(',')[1])
      const bin = new Uint8Array(dec.length)
      for (let j = 0; j < dec.length; j++) bin[j] = dec.charCodeAt(j)
      files.push(new Blob([bin], { type: m.type || 'application/octet-stream' }))
      files[files.length - 1]._name = m.name
    }
    let uploadData = { text: '', images: [] }
    if (files.length > 0) {
      const named = files.map((blob, i) => new File([blob], blob._name || ('file' + i), { type: blob.type }))
      uploadData = await aiUploadFiles(named)
    }
    await sleep(1000)
    return uploadData
  }

  function buildOpts(task, uploadData) {
    const ac = aiConfig.value
    const envPrompt = ac.systemPrompt ? (ac.systemPrompt.trim() + '\n\n') : ''
    const hist = collectChapterHistory(task.chapterId)
    return {
      ac,
      apiKey: getAiApiKey(ac.provider || 'ecnu'),
      provider: ac.provider || 'ecnu',
      model: effectiveModel(),
      finalPrompt: envPrompt + task.promptText,
      typeCounts: task.strategySnapshot ? task.strategySnapshot.typeCounts : { single: 10, judge: 5, term: 2, short: 1 },
      chapterHistory: hist,
      uploadData,
      chapterId: task.chapterId
    }
  }

  function applyStrategyCompliance(task, questions) {
    if (!questions || questions.length === 0) return
    const sc = { error: 0, review: 0, new: 0, unlabeled: 0 }
    questions.forEach((q) => {
      if (q.strategy && ['error', 'review', 'new'].indexOf(q.strategy) >= 0) sc[q.strategy]++
      else sc.unlabeled++
    })
    const st = task.strategySnapshot
    const totalQ2 = (st ? st.typeCounts.single + st.typeCounts.judge + st.typeCounts.term + st.typeCounts.short : questions.length) || questions.length
    const expErr = Math.round(totalQ2 * (st ? st.errPct : 60) / 100)
    const expRev = Math.round(totalQ2 * (st ? st.reviewPct : 20) / 100)
    const expNew = totalQ2 - expErr - expRev
    task.strategyCompliance = {
      expected: { error: expErr, review: expRev, new: expNew },
      actual: sc,
      ok: Math.abs(sc.error - expErr) <= 2 && Math.abs(sc.review - expRev) <= 2 && Math.abs(sc.new - expNew) <= 2
    }
  }

  function createEmptyQuizSet(chId) {
    const ch = data.state.chapters[chId]
    if (!ch) return null
    if (!ch.quizSets) ch.quizSets = []
    const set = { questions: [], userAnswers: [], currentIdx: 0, createdAt: Date.now() }
    ch.quizSets.push(set)
    ch.currentQuizSetIdx = ch.quizSets.length - 1
    return set
  }

  function normalizeQuestions(questions) {
    return questions
      .map((q, i) => { if (!q.id) q.id = i + 1; return q })
      .filter((q) => q.question && q.question.trim().length > 2)
  }

  function finishTask(task, ch) {
    if (ch && ch._hasNewFilesSinceLastGen) {
      ch._hasNewFilesSinceLastGen = false
      ch._lastGenTime = Date.now()
    }
    task.status = 'completed'
    task.completedAt = Date.now()
    task.questionCount = task.questionCount || 0
    abortController.value = null
    data.saveState()
    const msg = task.chapterName + ' 完成，生成 ' + task.questionCount + ' 题'
    ui.toast(msg, 'ok')
  }

  function failTask(task, error) {
    task.status = 'failed'
    task.error = error
    abortController.value = null
    data.saveState()
    ui.toast(task.chapterName + ' 失败：' + error, 'err')
  }

  async function streamGenerate(task, opts) {
    const emptySet = createEmptyQuizSet(task.chapterId)
    task.streamSetRef = emptySet
    const ch = data.state.chapters[task.chapterId]
    let lastSaveAt = 0

    const result = await aiStreamGenerate(
      {
        apiKey: opts.apiKey, provider: opts.provider, model: opts.model,
        textContent: opts.uploadData.text,
        typeCounts: opts.typeCounts,
        prompt: opts.finalPrompt,
        chapterHistory: opts.chapterHistory,
        chapterId: opts.chapterId,
        selfCheck: aiConfig.value.selfCheck === true
      },
      {
        signal: abortController.value ? abortController.value.signal : undefined,
        onProgress: (newParsed, totalCount) => {
          task.streamQuestionCount = totalCount
          if (task.streamSetRef) {
            task.streamSetRef.questions.push.apply(task.streamSetRef.questions, newParsed)
            const undefs = newParsed.map(() => undefined)
            task.streamSetRef.userAnswers.push.apply(task.streamSetRef.userAnswers, undefs)
          }
          const now = Date.now()
          if (now - lastSaveAt > 1000) {
            lastSaveAt = now
            data.saveState()
          }
        },
        onChunk: async (evt) => {
          if (evt.done && evt.questions && Array.isArray(evt.questions)) {
            const oldAnswers = task.streamSetRef ? task.streamSetRef.userAnswers.slice() : []
            if (task.streamSetRef) {
              task.streamSetRef.questions = evt.questions.slice()
              task.streamSetRef.userAnswers = []
              for (let k = 0; k < evt.questions.length; k++) {
                task.streamSetRef.userAnswers.push(k < oldAnswers.length && oldAnswers[k] !== undefined ? oldAnswers[k] : undefined)
              }
            }
          }
          if (evt.poolFilesStatus) task._poolFilesStatus = evt.poolFilesStatus
        }
      }
    )

    if (result.poolFilesStatus) task._poolFilesStatus = result.poolFilesStatus
    if (task.streamSetRef && ch) {
      if (!ch.questions) ch.questions = []
      result.questions.forEach((q) => ch.questions.push(q))
      if (!ch.userAnswers) ch.userAnswers = []
      ch.userAnswers = ch.userAnswers.concat(result.questions.map(() => undefined))
    }
    return normalizeQuestions(result.questions)
  }

  async function nonStreamGenerate(task, opts, retryPromptBase) {
    let questions = null
    let lastJson = ''
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !questions; attempt++) {
      if (attempt > 1) await sleep(2000 * (attempt - 1))
      const retryPrompt = attempt > 1
        ? retryPromptBase + '\n\n重要：你上次返回了无效JSON，错误是：' + lastJson + '。请修正后重新输出纯JSON数组。'
        : retryPromptBase
      const genRes = await fetchWithRetry(API_BASE + '/ai/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + getToken(),
          'x-ai-api-key': opts.apiKey,
          'x-ai-model': opts.model,
          'x-ai-provider': opts.provider
        },
        body: JSON.stringify({
          textContent: opts.uploadData.text,
          imageUrls: opts.uploadData.images,
          typeCounts: opts.typeCounts,
          prompt: opts.finalPrompt + (attempt > 1 ? retryPrompt.slice(retryPromptBase.length) : ''),
          selfCheck: aiConfig.value.selfCheck === true,
          chapterHistory: opts.chapterHistory,
          chapterId: opts.chapterId
        })
      }, 3, 5000)
      const genData = await genRes.json()
      if (genData.poolFilesStatus) task._poolFilesStatus = genData.poolFilesStatus
      let raw = genData.questions
      if (!raw && genData.output) raw = genData.output
      if (!raw && typeof genData === 'object') raw = Object.values(genData).find((v) => Array.isArray(v) || typeof v === 'string')
      if (typeof raw === 'string') {
        raw = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
        try { questions = JSON.parse(raw) } catch (e) {
          lastJson = e.message
          if (attempt < MAX_ATTEMPTS) continue
          else throw new Error('JSON格式错误: ' + e.message)
        }
      }
      if (Array.isArray(raw)) questions = raw
      if (!Array.isArray(questions) || questions.length === 0) {
        lastJson = '不是数组或为空'
        if (attempt < MAX_ATTEMPTS) continue
        else throw new Error('AI未返回有效题目')
      }
      questions = normalizeQuestions(questions)
      if (questions.length === 0) {
        lastJson = '题目内容为空'
        if (attempt < MAX_ATTEMPTS) continue
        else throw new Error('AI返回的题目全部为空')
      }
    }
    return questions
  }

  // —— 服务端任务路径 ——
  async function executeServerTask(task, opts) {
    const ac = opts.ac
    // 修复：刷新恢复的任务已带 serverTaskId → 复用已有服务端任务，
    // 不再重复创建（此前每次刷新都会新建一个服务端任务，额外占满队列）
    let serverTaskId = task.serverTaskId
    if (!serverTaskId) {
      const createData = await createAiServerTask({
        apiKey: opts.apiKey,
        provider: opts.provider,
        model: opts.model,
        body: {
          textContent: opts.uploadData.text,
          typeCounts: opts.typeCounts,
          prompt: opts.finalPrompt,
          chapterHistory: opts.chapterHistory,
          chapterId: task.chapterId,
          selfCheck: ac.selfCheck === true
        }
      })
      serverTaskId = createData.task.id
      task.serverTaskId = serverTaskId
      data.saveState()
      // T11: 服务端任务创建后启动自动轮询（本地 runner 中断/刷新后仍能自动续跑并导入结果）
      startServerTaskPolling()
    } else {
      console.log('[ai] 恢复服务端任务 #' + serverTaskId + '（复用，不重复创建）')
    }

    const startedAt = Date.now()
    while (true) {
      // 本地已取消（cancelTask 已把任务标记为 failed）→ 停止轮询，不再空等
      if (task.status !== 'running') return
      await sleep(2000)
      const serverTask = await getAiServerTask(serverTaskId)
      if (serverTask.status === 'completed') {
        const result = serverTask.result || {}
        const questions = normalizeQuestions(Array.isArray(result.questions) ? result.questions : [])
        // 幂等：若 8s 轮询 reconcile 已导入过，不再重复创建 quizSet（重复 set 会导致
        // currentQuizSetIdx 越界/答题入口错乱）
        if (!isServerTaskImported(serverTaskId)) {
          data.createQuizSetForChapter(questions, task.chapterId)
          markServerTaskImported(serverTaskId)
        }
        task.questionCount = questions.length
        finishTask(task, data.state.chapters[task.chapterId])
        return
      }
      if (serverTask.status === 'failed' || serverTask.status === 'canceled') {
        throw new Error(serverTask.error || (serverTask.status === 'canceled' ? '任务已取消' : '服务端任务未完成'))
      }
      if (Date.now() - startedAt > 20 * 60 * 1000) {
        throw new Error('服务端任务超时，请稍后在任务列表中查看')
      }
    }
  }

  async function executeTask(task) {
    task.status = 'running'
    data.saveState()
    const ch = data.state.chapters[task.chapterId]
    if (!ch) { failTask(task, '章节已删除'); return }
    const materials = getChapterMaterials(task.chapterId)
    if (!materials.length) { failTask(task, '资料已被删除'); return }

    const controller = new AbortController()
    abortController.value = controller

    try {
      const uploadData = await prepareUploadData(task)
      const opts = buildOpts(task, uploadData)
      const ac = opts.ac

      if (ac.useServerQueue === true) {
        await executeServerTask(task, opts)
        return
      }

      // v3.30.1：流式输出暂时停用（保留代码便于将来恢复）。
      // 原因：AI 二次校准（selfCheck）在流式下无法生效——边生成边刷题没有质量保证，
      // 用户答题节奏快于生成，二次校准失去价值；一律改为"生成完成 → 校验 → 一次性导入"。
      // 恢复方式：取消下方注释，并把末尾 createQuizSetForChapter 改回条件调用。
      // let questions = null
      // if (ac.streamMode === true) {
      //   questions = await streamGenerate(task, opts)
      //   if (!questions || questions.length === 0) {
      //     questions = await nonStreamGenerate(task, opts, task.promptText)
      //     if (questions && questions.length > 0 && task.streamSetRef &&
      //         (!task.streamSetRef.questions || task.streamSetRef.questions.length === 0)) {
      //       task.streamSetRef.questions = questions.slice()
      //       task.streamSetRef.userAnswers = new Array(questions.length).fill(undefined)
      //       task.streamSetRef.currentIdx = 0
      //       const ch2 = data.state.chapters[task.chapterId]
      //       if (ch2) {
      //         if (!ch2.questions) ch2.questions = []
      //         questions.forEach((q) => ch2.questions.push(q))
      //         if (!ch2.userAnswers) ch2.userAnswers = []
      //         ch2.userAnswers = ch2.userAnswers.concat(questions.map(() => undefined))
      //       }
      //     }
      //   }
      // } else {
      //   questions = await nonStreamGenerate(task, opts, task.promptText)
      // }
      const questions = await nonStreamGenerate(task, opts, task.promptText)

      applyStrategyCompliance(task, questions)
      // if (!(ac.streamMode === true && task.streamSetRef)) {
      //   data.createQuizSetForChapter(questions, task.chapterId)
      // }
      data.createQuizSetForChapter(questions, task.chapterId)
      task.questionCount = questions.length
      processPoolDiagnostics(task)
      finishTask(task, ch)
    } catch (e) {
      if (e.name === 'AbortError') failTask(task, '用户取消')
      else failTask(task, e.message || '生成失败')
      // 空题 set 回滚：流式预创建的空 quizSet 无意义，移除避免残留"空 in_progress 会话"（K3）
      if (task.streamSetRef && ch) {
        const idx = ch.quizSets ? ch.quizSets.indexOf(task.streamSetRef) : -1
        const empty = !task.streamSetRef.questions || task.streamSetRef.questions.length === 0
        if (idx >= 0 && empty) ch.quizSets.splice(idx, 1)
        delete task.streamSetRef
      }
    }
  }

  function processPoolDiagnostics(task) {
    if (task.poolFilesTotal !== undefined || !task._poolFilesStatus || !Array.isArray(task._poolFilesStatus)) return
    const pfs = task._poolFilesStatus
    const failed = pfs.filter((s) => !s.extracted || s.empty || s.error)
    if (failed.length > 0) {
      task.poolFileWarnings = failed.map((s) => s.name + ': ' + (s.error || (s.empty ? '内容为空' : '提取失败')))
    }
    const ok = pfs.filter((s) => s.extracted && !s.empty && !s.error)
    task.poolFilesUsed = ok.length
    task.poolFilesTotal = pfs.length
    delete task._poolFilesStatus
  }

  function cancelTask(taskId) {
    const task = data.state.aiTaskQueue.find((t) => t.id === taskId)
    if (!task) return
    if (task.status === 'pending') {
      data.state.aiTaskQueue = data.state.aiTaskQueue.filter((t) => t.id !== taskId)
      data.saveState()
      return
    }
    if (task.status === 'running') {
      if (task.serverTaskId) {
        cancelAiServerTask(task.serverTaskId).catch((e) => ui.toast(e.message, 'info'))
      }
      if (abortController.value) abortController.value.abort()
      abortController.value = null
      task.status = 'failed'
      task.error = '用户取消'
      data.saveState()
    }
  }

  function cancelAll() {
    if (abortController.value) abortController.value.abort()
    abortController.value = null
    runnerActive.value = false
    data.state.aiTaskQueue.forEach((t) => {
      if (t.status === 'running') { t.status = 'pending'; t.serverTaskId = t.serverTaskId || undefined }
    })
    // 同步取消服务端 queued 任务
    data.state.aiTaskQueue.forEach((t) => {
      if (t.status === 'pending' && t.serverTaskId) {
        cancelAiServerTask(t.serverTaskId).catch(() => {})
        delete t.serverTaskId
      }
    })
    data.saveState()
    ui.toast('已停止全部任务', 'info')
  }

  // —— v3.27：服务端任务列表（刷新恢复/导入/取消） ——
  async function refreshServerTasks() {
    if (!user.isOnline || !user.token) return
    serverTasksLoading.value = true
    try {
      serverTasks.value = await listAiServerTasks(50)
      reconcileServerTasks()
    } catch (e) {
      console.warn('[ai] refreshServerTasks failed:', e.message)
    } finally {
      serverTasksLoading.value = false
    }
  }

  // 将服务端任务与本地队列关联（按 serverTaskId），本地运行中任务若已由服务端完成则同步状态
  // 修复：自动导入后记录 importedServerTaskIds（持久化），列表不再显示可重复导入的任务
  function markServerTaskImported(id) {
    if (!id) return
    if (!data.state.importedServerTaskIds) data.state.importedServerTaskIds = []
    if (!data.state.importedServerTaskIds.includes(id)) {
      data.state.importedServerTaskIds.push(id)
      // 仅保留最近 100 条，防止无限增长
      if (data.state.importedServerTaskIds.length > 100) {
        data.state.importedServerTaskIds = data.state.importedServerTaskIds.slice(-100)
      }
    }
  }
  function reconcileServerTasks() {
    const queue = data.state.aiTaskQueue || []
    serverTasks.value.forEach((st) => {
      const local = queue.find((t) => t.serverTaskId === st.id)
      if (!local) return
      if (st.status === 'completed' && local.status !== 'completed') {
        const questions = normalizeQuestions((st.result && Array.isArray(st.result.questions)) ? st.result.questions : [])
        // 幂等：并发/重复轮询只导入一次
        if (questions.length > 0 && !isServerTaskImported(st.id)) {
          data.createQuizSetForChapter(questions, local.chapterId)
          markServerTaskImported(st.id)
        }
        local.status = 'completed'
        local.questionCount = questions.length
        local.completedAt = Date.now()
        // 保留 serverTaskId：本地任务区过滤 serverTaskId，服务端任务才不落本地列表
        data.saveState()
        ui.toast(local.chapterName + ' 服务端任务完成，已导入 ' + questions.length + ' 题', 'ok')
      } else if (st.status === 'failed' || st.status === 'canceled') {
        if (local.status === 'running' || local.status === 'pending') {
          local.status = 'failed'
          local.error = st.error || '服务端任务未完成'
          data.saveState()
        }
      }
    })
    // 已导入/已结束的任务不再占列表（防止重复导入按钮）
    serverTasks.value = serverTasks.value.filter((st) => {
      if (st.status === 'completed' && isServerTaskImported(st.id)) return false
      return true
    })
  }
  function isServerTaskImported(id) {
    return !!(data.state.importedServerTaskIds && data.state.importedServerTaskIds.includes(id))
  }

  // —— T11: 服务端任务自动轮询续跑 ——
  // 修复 P1-5：此前 serverPollTimer 声明未用，刷新后不自动续跑；
  // 现在只要有 queued/running 服务端任务就自动轮询并 reconcile，
  // 全部结束（且队列弹窗关闭）后自动停止。
  const SERVER_POLL_MS = 8000

  function hasActiveServerTasks() {
    return (serverTasks.value || []).some((st) => st.status === 'queued' || st.status === 'running')
  }

  async function pollServerTasksOnce() {
    try {
      await refreshServerTasks()
    } catch (e) {
      console.warn('[ai] server poll tick failed:', e && e.message)
    }
    if (!hasActiveServerTasks() && !queueDialogOpen.value) stopServerTaskPolling()
  }

  function startServerTaskPolling() {
    if (serverPollTimer.value) return
    serverPollTimer.value = setInterval(pollServerTasksOnce, SERVER_POLL_MS)
    if (serverPollTimer.value && typeof serverPollTimer.value.unref === 'function') {
      serverPollTimer.value.unref()
    }
  }

  function stopServerTaskPolling() {
    if (serverPollTimer.value) clearInterval(serverPollTimer.value)
    serverPollTimer.value = null
  }

  async function importServerTaskResult(serverTask) {
    if (isServerTaskImported(serverTask.id)) {
      ui.toast('该任务已导入过，请勿重复导入', 'info')
      serverTasks.value = serverTasks.value.filter((st) => st.id !== serverTask.id)
      return null
    }
    const questions = normalizeQuestions((serverTask.result && Array.isArray(serverTask.result.questions)) ? serverTask.result.questions : [])
    if (questions.length === 0) { ui.toast('该任务没有可导入的题目', 'err'); return }
    if (!data.state.chapters[serverTask.chapterId]) { ui.toast('章节已删除，无法导入', 'err'); return }
    const set = data.createQuizSetForChapter(questions, serverTask.chapterId)
    markServerTaskImported(serverTask.id)
    data.saveState()
    // 导入后立即从列表移除，按钮消失
    serverTasks.value = serverTasks.value.filter((st) => st.id !== serverTask.id)
    ui.toast('已导入 ' + questions.length + ' 题', 'ok')
    return set
  }

  async function cancelServerTask(taskId) {
    try {
      await cancelAiServerTask(taskId)
      await refreshServerTasks()
      ui.toast('已取消服务端任务', 'info')
    } catch (e) {
      ui.toast(e.message, 'err')
    }
  }

  function openQueueDialog() {
    queueDialogOpen.value = true
    refreshServerTasks()
    startServerTaskPolling()
  }
  function closeQueueDialog() {
    queueDialogOpen.value = false
    if (!hasActiveServerTasks()) stopServerTaskPolling()
  }

  // —— 资料文件添加/删除 ——
  function getExtIcon(name) {
    const ext = (name || '').split('.').pop().toLowerCase()
    if (ext === 'pdf') return 'file'
    if (ext === 'doc' || ext === 'docx') return 'edit'
    if (ext === 'ppt' || ext === 'pptx') return 'chart'
    if (ext === 'txt' || ext === 'md') return 'file'
    return 'paperclip'
  }

  async function addMaterialFiles(chapterId, fileList) {
    const ch = data.state.chapters[chapterId]
    if (!ch) { ui.toast('请先选择章节', 'err'); return }
    const materials = getChapterMaterials(chapterId)
    const allowedExts = ['pdf', 'doc', 'docx', 'pptx', 'txt', 'md']
    let added = 0
    for (const f of fileList) {
      const ext = f.name.split('.').pop().toLowerCase()
      if (allowedExts.indexOf(ext) === -1) { ui.toast(f.name + ' 类型不支持，已跳过', 'info'); continue }
      if (f.size > 20 * 1024 * 1024) { ui.toast(f.name + ' 超过20MB，已跳过', 'info'); continue }
      if (materials.find((m) => m.name === f.name && m.size === f.size)) { ui.toast(f.name + ' 已存在，已跳过', 'info'); continue }
      const dataUrl = await readFileAsDataUrl(f)
      const mid = generateMaterialId()
      materials.push({ name: f.name, size: f.size, addedAt: Date.now(), id: mid })
      saveChapterMaterials(chapterId, materials)
      try { await idbStoreMaterial(mid, dataUrl) } catch (e) {
        ui.toast('保存资料失败：' + f.name, 'err')
        const idx = materials.length - 1
        materials.splice(idx, 1)
        saveChapterMaterials(chapterId, materials)
        continue
      }
      added++
      // 同步上传到服务端文件池（失败不阻塞）
      try {
        const upFd = new FormData()
        const dec = atob(dataUrl.split(',')[1])
        const bin = new Uint8Array(dec.length)
        for (let k = 0; k < dec.length; k++) bin[k] = dec.charCodeAt(k)
        upFd.append('file', new Blob([bin]), f.name)
        upFd.append('chapterId', chapterId)
        fetchWithAuth('/files/upload', { method: 'POST', body: upFd }).then((r) => {
          if (r && r.status === 409) {
            r.json().then((d) => ui.toast(d.error || '文件重复', 'info')).catch(() => {})
          }
        }).catch(() => {})
      } catch (e) { /* ignore */ }
    }
    if (added > 0 && ch) ch._hasNewFilesSinceLastGen = true
    data.saveState()
  }

  function removeMaterial(chapterId, idx) {
    const materials = getChapterMaterials(chapterId)
    const removed = materials.splice(idx, 1)
    if (removed.length) idbDeleteMaterial(removed[0].id)
    saveChapterMaterials(chapterId, materials)
  }

  // 过期/删除的文件池文件不再显示在复习资料里：移除 chapterMaterials 中
  // 已不在文件池（名称+大小不匹配）的 _poolFile 条目。
  function reconcilePoolMaterials(chapterId, poolFiles) {
    const materials = getChapterMaterials(chapterId)
    const valid = new Set((poolFiles || []).map((f) => (f.originalName || '') + '|' + (f.fileSize || 0)))
    const kept = materials.filter((m) => !m._poolFile || valid.has((m.name || '') + '|' + (m.size || 0)))
    if (kept.length !== materials.length) {
      saveChapterMaterials(chapterId, kept)
      return true
    }
    return false
  }

  async function assignPoolFileToChapter(chapterId, fileId) {
    const res = await fetchWithAuth('/files/' + fileId + '/assign', {
      method: 'POST',
      body: JSON.stringify({ chapterId })
    })
    if (!res || !res.ok) {
      const err = res ? await readApiErrorSafe(res) : '分配失败'
      throw new Error(err)
    }
    const data2 = await res.json()
    const f = data2.file
    const materials = getChapterMaterials(chapterId)
      // 同一章节重复关联同一池文件 → 幂等提示，不重复添加（多章节关联后更易误点）
  if (materials.some((m) => m._poolFile && m.name === f.originalName && m.size === f.fileSize)) {
    ui.toast('该文件已关联本章节', 'info')
    return
  }
  materials.push({ name: f.originalName, size: f.fileSize, addedAt: Date.now(), id: generateMaterialId(), _poolFile: true })
    saveChapterMaterials(chapterId, materials)
    const ch = data.state.chapters[chapterId]
    if (ch) ch._hasNewFilesSinceLastGen = true
    data.saveState()
  }

  return {
    providers, providersLoaded, providersError, runnerActive, abortController,
    queueDialogOpen, serverTasks, serverTasksLoading,
    aiConfig,
    getChapterMaterials, saveChapterMaterials,
    ensureProviders, getProvider, defaultModelFor, rememberModel, recalledModel, effectiveModel,
    saveAiConfig, clearApiKey, testConnection,
    enqueueGenerate, cancelTask, cancelAll, hasTaskForChapter,
    refreshServerTasks, importServerTaskResult, cancelServerTask,
    openQueueDialog, closeQueueDialog,
    startServerTaskPolling, stopServerTaskPolling, hasActiveServerTasks, isServerTaskImported,
    addMaterialFiles, removeMaterial, assignPoolFileToChapter, reconcilePoolMaterials, getExtIcon,
    formatFileSize
  }
})

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

async function readApiErrorSafe(res) {
  try {
    const data = await res.json()
    return (data && data.error) || '操作失败'
  } catch (e) { return '操作失败' }
}