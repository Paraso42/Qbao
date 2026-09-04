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

  // —— 任务执行归属（round5.1：多端重复生成修复） ——
  // 多窗口/多端同时在线时，云端队列合并会把一端创建的任务带到另一端；老逻辑对
  // “合并进来的 pending 任务”也自动执行 → 一次点击被多处生成（14:38/15:24 实测
  // 各多出一轮本地直连题目：一端走服务端任务、另一端本地直连，两轮内容不同）。
  // 现在任务只允许创建它的实例执行：
  //  · enqueueGenerate 打 _owner（标签页会话 id，sessionStorage；刷新同标签页不变，
  //    新标签页/新端是新 id）
  //  · 他端见到的 pending 任务不执行，等属主结果（服务端任务由轮询导入，不重复调 AI）
  //  · 属主失联（创建超过 CLAIM_MS 仍 pending/running 无进展）才允许接管/标记
  //  · 旧版本遗留无属主任务：只接管陈旧的，避免误执行他端新任务
  const CLAIM_MS = 10 * 60 * 1000
  let _myOwner = null
  function myOwnerId() {
    if (_myOwner) return _myOwner
    try {
      const k = 'qbao_task_owner'
      const ss = (typeof sessionStorage !== 'undefined') ? sessionStorage : null
      let v = ss ? ss.getItem(k) : null
      if (!v) {
        v = 'o_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9)
        if (ss) ss.setItem(k, v)
      }
      _myOwner = v
    } catch (e) {
      _myOwner = 'o_' + Date.now().toString(36)
    }
    return _myOwner
  }
  function taskStale(t) {
    const created = typeof t.createdAt === 'number' ? t.createdAt : 0
    return !created || Date.now() - created > CLAIM_MS
  }
  // 本端是否可以执行该任务（AI 调用全局只能发生一次）：
  //  · 带 serverTaskId → 执行只是轮询复用已有服务端任务，不会重复调 AI → 任何端都可（恢复路径）
  //  · 无 serverTaskId（本地直连）→ 仅属主可执行；无属主/他端任务只在他端失联后才接管
  function mayExecutePending(t) {
    if (!t || t.status !== 'pending') return false
    if (t.serverTaskId) return true
    if (!t._owner) return taskStale(t)
    if (t._owner === myOwnerId()) return true
    return taskStale(t)
  }
  // 失败标记类操作（刷新取消/在途判定）只对“属主为本端或无属主旧任务”生效，
  // 不干预他端正在执行的任务（本地优先合并不会覆盖属主副本，标记只会造成噪音）
  function taskOwnedByMeOrLegacy(t) {
    return !t || !t._owner || t._owner === myOwnerId()
  }

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

  // K1 规则本地前置校验（服务端有 409 兜底）：
  // 任意一轮存在未做完的题目（含被 JSON 往返转成 null 的未作答位）→ 不允许继续出题。
  // 与出题入口（getActionableQuizSet）同口径，避免“有未完成轮次却无入口”的死锁。
  function hasUnfinishedQuestions(ch) {
    return data.hasUnfinishedQuizSet(ch)
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
      _owner: myOwnerId(),
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
    pruneTaskQueue()
    const position = data.state.aiTaskQueue.filter((t) => t.status === 'pending').length
    ui.toast(ch.name + ' 已加入队列，排在第 ' + position + ' 位', 'info')
  }

  async function runnerLoop() {
    while (runnerActive.value) {
      // 只执行本端有归属的任务（他端任务等属主结果；服务端任务轮询复用）
      const pendingTask = data.state.aiTaskQueue.find((t) => mayExecutePending(t))
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
    const expected = task._expectedTotal
    const short = typeof expected === 'number' && expected > 0 && task.questionCount < expected
    const msg = short
      ? task.chapterName + ' 完成，生成 ' + task.questionCount + '/' + expected + ' 题（AI 未能补足题量，可重试一次）'
      : task.chapterName + ' 完成，生成 ' + task.questionCount + ' 题'
    ui.toast(msg, short ? 'info' : 'ok')
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
    delete task._wasRunning
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

  // —— 刷新后恢复队列（T-round4）： ——
  // 页面刷新时 migrateState 已把 running 任务重置为 pending 并打 _wasRunning 标记。
  //  · 未开始的排队任务 → 直接继续跑；
  //  · 服务端任务（serverTaskId 已持久化）→ 复用任务继续轮询，不重复创建、不重复扣费；
  //  · 本地直连且 AI 请求已在途的任务 → 无法得知请求是否已扣费/已生成，直接继续会
  //    重复调用 AI（重复扣费/可能生成重复轮次）→ 标记失败并明确提示，让用户重试。
  let _resumed = false
  // 清理可能残留的空流式 set
  function dropEmptyStreamSet(t) {
    if (!t.streamSetRef) return
    const ch = data.state.chapters[t.chapterId]
    if (ch && ch.quizSets) {
      const idx = ch.quizSets.indexOf(t.streamSetRef)
      if (idx >= 0 && (!t.streamSetRef.questions || t.streamSetRef.questions.length === 0)) {
        ch.quizSets.splice(idx, 1)
      }
    }
    delete t.streamSetRef
  }

  // 队列恢复/重裁决（启动时 + 每次云端合并后调用，幂等）：
  //  · pending（未开始/服务端任务）→ 启动 runner 执行（executeServerTask 复用 serverTaskId）；
  //  · running 且无 serverTaskId（本地直连在途，可能被云端旧状态带回）→ 明确失败防卡死/防重复调用 AI；
  //  · 服务端任务 running → 启动轮询以便续跑与导入。
  function reconcileQueue() {
    const queue = data.state.aiTaskQueue || []
    let changed = false
    let needRunner = false
    let needPolling = false
    queue.forEach((t) => {
      if (!t) return
      if (t.status === 'running' && !t.serverTaskId) {
        // 云端带回的“运行中”本地直连任务：属主为本端/旧任务/属主失联 → 明确失败防止
        // 卡死或重复调用 AI；他端在途任务不干预（由属主实例继续/善后）
        if (taskOwnedByMeOrLegacy(t) || taskStale(t)) {
          t.status = 'failed'
          t.error = '出题过程中页面被刷新，本轮已取消，请重新点击「开始出题」'
          changed = true
        }
      }
      if (t._wasRunning && !t.serverTaskId && t.status !== 'failed') {
        // 刷新前已在途、AI 请求可能已扣费 → 属主明确失败，不静默重跑
        if (taskOwnedByMeOrLegacy(t)) {
          t.status = 'failed'
          t.error = '出题过程中页面被刷新，本轮已取消，请重新点击「开始出题」'
          changed = true
        }
      }
      delete t._wasRunning
      if (t.status === 'pending' && mayExecutePending(t)) needRunner = true
      if (t.serverTaskId && (t.status === 'pending' || t.status === 'running')) needPolling = true
    })
    if (changed) data.saveState()
    if (needRunner && !runnerActive.value) {
      // runner 未在运行 → 启动（运行中则其循环会自行拾取 pending 任务）
      runnerActive.value = true
      runnerLoop()
    }
    if (needPolling) startServerTaskPolling()
    pruneTaskQueue()
  }

  function resumeQueuedTasks() {
    if (_resumed) return
    _resumed = true
    const queue = data.state.aiTaskQueue || []
    let changed = false
    queue.forEach((t) => {
      if (!t) return
      // 本地直连且刷新前已在途（_wasRunning）：无法得知 AI 请求是否已扣费/已生成，
      // 直接续跑会重复调用 AI → 标记失败并明确提示，让用户重试
      if (t._wasRunning && !t.serverTaskId) {
        if (taskOwnedByMeOrLegacy(t)) {
          t.status = 'failed'
          t.error = '出题过程中页面被刷新，本轮已取消，请重新点击「开始出题」'
          changed = true
          dropEmptyStreamSet(t)
        }
      }
      delete t._wasRunning
    })
    if (changed) data.saveState()
    reconcileQueue()
  }

  // 任务队列剪枝：已完成/失败任务无限累积（含大 promptText）会缓慢撑大 localStorage；
  // 只保留最近的 40 条历史任务，进行中/排队中的任务永不清除（顺序保持原序）
  function pruneTaskQueue() {
    const queue = data.state.aiTaskQueue
    if (!Array.isArray(queue) || queue.length <= 50) return
    const isActive = (t) => t && (t.status === 'pending' || t.status === 'running')
    const inactive = queue.map((t, i) => ({ t, i })).filter((x) => !isActive(x.t)).sort((a, b) => b.i - a.i)
    const keepIdx = new Set(inactive.slice(0, 40).map((x) => x.i))
    const kept = queue.filter((t, i) => isActive(t) || keepIdx.has(i))
    if (kept.length !== queue.length) data.state.aiTaskQueue = kept
  }

  // 刷新/启动即恢复队列（boot 也会调用；幂等标记保证只跑一次）
  resumeQueuedTasks()

  return {
    providers, providersLoaded, providersError, runnerActive, abortController,
    queueDialogOpen, serverTasks, serverTasksLoading,
    aiConfig,
    getChapterMaterials, saveChapterMaterials,
    ensureProviders, getProvider, defaultModelFor, rememberModel, recalledModel, effectiveModel,
    saveAiConfig, clearApiKey, testConnection,
    enqueueGenerate, cancelTask, cancelAll, hasTaskForChapter, resumeQueuedTasks, reconcileQueue, pruneTaskQueue,
    refreshServerTasks, importServerTaskResult, cancelServerTask,
    openQueueDialog, closeQueueDialog,
    startServerTaskPolling, stopServerTaskPolling, hasActiveServerTasks, isServerTaskImported,
    addMaterialFiles, removeMaterial, assignPoolFileToChapter, reconcilePoolMaterials, getExtIcon,
    formatFileSize
  }
})