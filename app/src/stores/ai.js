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
  fetchProvidersList, aiTest,
  createAiServerTask, getAiServerTask, listAiServerTasks, cancelAiServerTask,
  explainWrongQuestion as explainWrongQuestionApi,
} from '../services/aiApi'
import { getQuestionId } from '../services/questions'
import { getAiApiKey, setAiApiKey, removeAiApiKey, hasAnyAiApiKey } from '../services/aiKeys'
import { generatePromptText } from '../services/strategy'
import { formatFileSize, sleep } from '../services/utils'
// v3.32 (P2.1)：生成核心与历史统计拆分到独立服务模块，store 只保留编排
import { collectChapterHistory } from '../services/aiHistory'
import { normalizeQuestions, applyStrategyCompliance, nonStreamGenerate, processPoolDiagnostics, prepareUploadData } from '../services/aiTasks'
import { createServerTaskController } from '../services/aiServerTasks'
import { createMaterialManager } from '../services/aiMaterials'

export const useAiStore = defineStore('ai', () => {
  const data = useDataStore()
  const user = useUserStore()
  const ui = useUiStore()

  const providers = ref([])
  const providersLoaded = ref(false)
  const runnerActive = ref(false)
  const abortController = ref(null)
  // v3.32 (P2.1)：服务端任务列表/轮询/导入由独立 controller 提供
  const {
    serverTasks, serverTasksLoading, queueDialogOpen,
    refreshServerTasks, markServerTaskImported, isServerTaskImported,
    hasActiveServerTasks, startServerTaskPolling, stopServerTaskPolling,
    importServerTaskResult, cancelServerTask, openQueueDialog, closeQueueDialog,
  } = createServerTaskController({ data, user, ui })
  // v3.32 (P2.1)：章节资料管理（元数据/IDB/文件池关联）独立成 manager
  const {
    getChapterMaterials, saveChapterMaterials, getExtIcon,
    addMaterialFiles, removeMaterial, reconcilePoolMaterials, assignPoolFileToChapter,
  } = createMaterialManager({ data, ui })

  const aiConfig = computed(() => data.state.aiConfig || {})

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

  // —— P3.1 错题 AI 讲解（结果缓存 data.state.wrongBook，可回看；上限 200 条 LRU） ——
  async function explainWrongAnswer(item, context) {
    const ac = data.state.aiConfig || {}
    const provider = ac.provider || 'ecnu'
    const apiKey = getAiApiKey(provider)
    if (!apiKey) throw new Error('请先在设置中配置 AI 密钥')
    const qId = item.qId || getQuestionId(item.cid || '', item.q)
    if (!data.state.wrongBook) data.state.wrongBook = {}
    const cached = data.state.wrongBook[qId]
    if (cached && !item.force) return cached
    const res = await explainWrongQuestionApi({
      apiKey,
      provider,
      model: effectiveModel(),
      question: item.q,
      userAnswer: item.userAnswer,
      context,
    })
    data.state.wrongBook[qId] = { explanation: res.explanation, model: res.model, provider: res.provider, at: Date.now() }
    const keys = Object.keys(data.state.wrongBook)
    if (keys.length > 200) {
      const stale = keys.slice().sort((a, b) => (data.state.wrongBook[a].at || 0) - (data.state.wrongBook[b].at || 0))
      stale.slice(0, keys.length - 200).forEach((k) => { delete data.state.wrongBook[k] })
    }
    data.saveState()
    return data.state.wrongBook[qId]
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

  function buildOpts(task, uploadData) {
    const ac = aiConfig.value
    const envPrompt = ac.systemPrompt ? (ac.systemPrompt.trim() + '\n\n') : ''
    const hist = collectChapterHistory(data.state, task.chapterId)
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
      const uploadData = await prepareUploadData(getChapterMaterials(task.chapterId), task)
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
      // P2.1 拆分后 nonStreamGenerate 需要 deps：修复"出题报 TypeError: deps.aiSelfCheck"（v3.32 起客户端出题必失败）
      const questions = await nonStreamGenerate(task, opts, task.promptText, { aiSelfCheck: ac.selfCheck === true })

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

  return {
    providers, providersLoaded, providersError, runnerActive, abortController,
    queueDialogOpen, serverTasks, serverTasksLoading,
    aiConfig,
    getChapterMaterials, saveChapterMaterials,
    ensureProviders, getProvider, defaultModelFor, rememberModel, recalledModel, effectiveModel,
    saveAiConfig, clearApiKey, testConnection, explainWrongAnswer,
    enqueueGenerate, cancelTask, cancelAll, hasTaskForChapter,
    refreshServerTasks, importServerTaskResult, cancelServerTask,
    openQueueDialog, closeQueueDialog,
    startServerTaskPolling, stopServerTaskPolling, hasActiveServerTasks, isServerTaskImported,
    addMaterialFiles, removeMaterial, assignPoolFileToChapter, reconcilePoolMaterials, getExtIcon,
    formatFileSize
  }
})