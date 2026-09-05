// P1.4 ai store 核心流转单测（AI 配置保存/密钥安全边界/队列前置校验）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('../services/aiApi', () => ({
  fetchProvidersList: vi.fn(async () => []),
  aiTest: vi.fn(async () => ({ ok: true })),
  aiUploadFiles: vi.fn(),
  aiStreamGenerate: vi.fn(),
  createAiServerTask: vi.fn(),
  getAiServerTask: vi.fn(),
  listAiServerTasks: vi.fn(async () => []),
  cancelAiServerTask: vi.fn(),
}))

import { useAiStore } from './ai'
import { useDataStore } from './data'
import { useUserStore } from './user'
import { useUiStore } from './ui'
import { getAiApiKey } from '../services/aiKeys'

function makeLocalStorageStub(seed = {}) {
  const map = new Map(Object.entries(seed))
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)) },
    removeItem: (k) => { map.delete(k) },
    _map: map,
  }
}

function makeSessionStorageStub(seed = {}) {
  const map = new Map(Object.entries(seed))
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)) },
    removeItem: (k) => { map.delete(k) },
    _map: map,
  }
}

// 与 store 内 myOwnerId() 同键的会话属主 id（每个测试进程稳定）
function ownerId() {
  const key = 'qbao_task_owner'
  if (!globalThis.sessionStorage) globalThis.sessionStorage = makeSessionStorageStub()
  let v = globalThis.sessionStorage.getItem(key)
  if (!v) { v = 'o_test_instance'; globalThis.sessionStorage.setItem(key, v) }
  return v
}

function seedState() {
  return {
    subjects: { s1: { id: 's1', name: '科目', chapterIds: ['c1'], collapsed: false } },
    subjectOrder: ['s1'],
    currentSubjectId: 's1',
    currentChapterId: 'c1',
    chapters: {
      c1: {
        id: 'c1', name: '章一', questions: [],
        strategy: { errPct: 20, reviewPct: 50, newPct: 30, typeCounts: { single: 5, judge: 5, term: 3, short: 2 }, errorTags: [], reviewTags: [], newTopicTags: [], tagMeta: {} },
      },
    },
    history: [], lastScreen: 'start', generatedExams: {},
    achievements: { unlocked: [], history: [] }, settings: { darkMode: false },
    aiConfig: { provider: 'ecnu', model: 'ecnu-plus', providerKeys: undefined, apiKeySet: false, systemPrompt: '' },
    aiTaskQueue: [], importedServerTaskIds: [], chapterMaterials: {},
  }
}

function setupStores() {
  return { ai: useAiStore(), ui: useUiStore() }
}

describe('ai store 核心流转 (P1.4/P1.3 路径)', () => {
  let storage
  beforeEach(() => {
    storage = makeLocalStorageStub({})
    globalThis.localStorage = storage
      globalThis.sessionStorage = makeSessionStorageStub()
    setActivePinia(createPinia())
    storage.setItem('qbao_user', JSON.stringify({ id: 'u1', username: 'a' }))
    storage.setItem('quizEngineState_cloud_u1', JSON.stringify(seedState()))
    useDataStore()
    vi.clearAllMocks()
  })
  afterEach(() => { delete globalThis.localStorage; delete globalThis.sessionStorage; vi.restoreAllMocks() })

  it('saveAiConfig：模型记忆 + 密钥走 aiKeys 存储（state 不含明文）+ apiKeySet 置位', () => {
    const { ai } = setupStores()
    ai.saveAiConfig({ provider: 'deepseek', model: 'deepseek-v4-pro', apiKey: 'sk-ds-1', systemPrompt: '你是助教' })
    const data = useDataStore()
    expect(data.state.aiConfig.provider).toBe('deepseek')
    expect(data.state.aiConfig.model).toBe('deepseek-v4-pro')
    expect(data.state.aiConfig.modelByProvider.deepseek).toBe('deepseek-v4-pro')
    expect(data.state.aiConfig.apiKeySet).toBe(true)
    expect(data.state.aiConfig.apiKey).toBeUndefined()
    expect(data.state.aiConfig.providerKeys).toBeUndefined()
    expect(getAiApiKey('deepseek')).toBe('sk-ds-1')
    // 下次读取 effectiveModel 记忆模型优先
    expect(ai.effectiveModel()).toBe('deepseek-v4-pro')
  })

  it('clearApiKey：清除后 apiKeySet 同步为 false', () => {
    const { ai } = setupStores()
    const data = useDataStore()
    ai.saveAiConfig({ provider: 'ecnu', apiKey: 'sk-e' })
    expect(data.state.aiConfig.apiKeySet).toBe(true)
    ai.clearApiKey('ecnu')
    expect(getAiApiKey('ecnu')).toBe('')
    expect(data.state.aiConfig.apiKeySet).toBe(false)
  })

  it('enqueueGenerate 前置校验：无复习资料拒绝入队（toast 提示）', () => {
    const { ai, ui } = setupStores()
    ai.enqueueGenerate('c1', { single: 2, judge: 0, term: 0, short: 0 })
    const data = useDataStore()
    expect(data.state.aiTaskQueue).toHaveLength(0)
    expect(ui.toasts.some((t) => t.message.includes('请先上传复习资料'))).toBe(true)
  })

  it('enqueueGenerate：任意一轮未做完（含旧轮）→ 拒绝入队并提示（K1 守卫同服务端 409 口径）', () => {
    const { ai, ui } = setupStores()
    const data = useDataStore()
    useUserStore().applyAuth({ token: 't', user: { id: 1, username: 'test' } })
    data.state.chapterMaterials['c1'] = [{ id: 'm1', name: '资料' }]
    const ch = data.state.chapters.c1
    ch.quizSets = [
      { questions: [{ id: 'q1', question: '旧轮第一题', type: 'single', options: ['A', 'B'], answer: 0 }], userAnswers: [null], currentIdx: 0, createdAt: 1 },
      { questions: [{ id: 'q2', question: '新轮第一题', type: 'single', options: ['A', 'B'], answer: 0 }], userAnswers: [0], currentIdx: 0, createdAt: 2 },
    ]
    ch.currentQuizSetIdx = 1
    ai.enqueueGenerate('c1', { single: 1, judge: 0, term: 0, short: 0 })
    expect(data.state.aiTaskQueue).toHaveLength(0)
    expect(ui.toasts.some((t) => t.message.includes('还有未做完的题目'))).toBe(true)
    // 全部答完后守卫放行（不再提示未完成，避免启动 runner 故直接断言守卫数据源）
    ch.quizSets[0].userAnswers = [0]
    expect(data.hasUnfinishedQuizSet(ch)).toBe(false)
  })
  it('hasTaskForChapter：章节已有 pending/running 任务时防重复入队（K1 守卫）', () => {
    const { ai } = setupStores()
    const data = useDataStore()
    expect(ai.hasTaskForChapter('c1')).toBe(false)
    data.state.aiTaskQueue.push({ id: 't1', chapterId: 'c1', status: 'pending' })
    expect(ai.hasTaskForChapter('c1')).toBe(true)
    data.state.aiTaskQueue[0].status = 'running'
    expect(ai.hasTaskForChapter('c1')).toBe(true)
    data.state.aiTaskQueue[0].status = 'done'
    expect(ai.hasTaskForChapter('c1')).toBe(false)
  })

  it('testConnection：未配置密钥时抛出可读错误（不裸奔到网络层）', async () => {
    const { ai } = setupStores()
    const data = useDataStore()
    data.state.aiConfig.provider = 'ecnu'
    await expect(ai.testConnection()).rejects.toThrow('请先保存 API 密钥')
  })

  it('rememberModel/recalledModel 按 provider 记忆模型', () => {
    const { ai } = setupStores()
    const data = useDataStore()
    data.state.aiConfig.modelByProvider = undefined
    expect(ai.recalledModel('ecnu')).toBe('ecnu-plus') // 默认回退
    ai.rememberModel('gemini', 'gemini-2.0-flash')
    expect(ai.recalledModel('gemini')).toBe('gemini-2.0-flash')
  })
})

describe('resumeQueuedTasks 刷新恢复 (round4)', () => {
  let storage
  beforeEach(() => {
    storage = makeLocalStorageStub({})
    globalThis.localStorage = storage
      globalThis.sessionStorage = makeSessionStorageStub()
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })
  afterEach(() => { delete globalThis.localStorage; delete globalThis.sessionStorage; vi.restoreAllMocks() })

  function seed(queue) {
    const st = seedState()
    st.aiTaskQueue = queue
    storage.setItem('qbao_user', JSON.stringify({ id: 'u1', username: 'a' }))
    storage.setItem('quizEngineState_cloud_u1', JSON.stringify(st))
  }

  it('刷新前已在途的本地直连任务（_wasRunning 且无 serverTaskId）→ 标记失败并给出明确提示，不静默重复调用 AI', async () => {
    seed([{ id: 't1', chapterId: 'c1', chapterName: '章一', status: 'pending', _wasRunning: true,
      promptText: 'p', materialNames: [], strategySnapshot: null, createdAt: 1, completedAt: null,
      questionCount: 0, error: '', streamQuestionCount: 0, streamSetRef: null, _expectedTotal: 5 }])
    const { ai } = setupStores()
    const data = useDataStore()
    const task = data.state.aiTaskQueue[0]
    expect(task.status).toBe('failed')
    expect(task.error).toContain('页面被刷新')
    expect(task._wasRunning).toBeUndefined()
    // 没有空格子：会话/章节可重新出题（hasTaskForChapter 只看 pending/running）
    expect(ai.hasTaskForChapter('c1')).toBe(false)
  })

  it('未开始的排队任务 → 自动续跑（runner 启动，开始执行任务）', async () => {
    seed([{ id: 't2', chapterId: 'c1', chapterName: '章一', status: 'pending',
      promptText: 'p', materialNames: [], strategySnapshot: null, createdAt: 1, completedAt: null,
      questionCount: 0, error: '', streamQuestionCount: 0, streamSetRef: null, _expectedTotal: 5, _owner: ownerId() }])
    const { ai } = setupStores()
    // 无资料 → 执行路径会以“资料已被删除”失败收场，但状态流转证明 runner 已接管
    await vi.waitFor(() => {
      const data = useDataStore()
      const task = data.state.aiTaskQueue[0]
      expect(['failed', 'completed']).toContain(task.status)
      if (task.status === 'failed') expect(task.error).toContain('资料')
      if (ai.runnerActive) throw new Error('runner 仍在运行')
    }, { timeout: 2000, interval: 50 })
  })
})

describe('pruneTaskQueue 队列剪枝 (round4)', () => {
  let storage
  beforeEach(() => {
    storage = makeLocalStorageStub({})
    globalThis.localStorage = storage
      globalThis.sessionStorage = makeSessionStorageStub()
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })
  afterEach(() => { delete globalThis.localStorage; delete globalThis.sessionStorage; vi.restoreAllMocks() })

  it('completed/failed 只留最近 40 条，pending 任务与顺序不受影响', () => {
    const st = seedState()
    const mk = (id, status) => ({ id, chapterId: 'c1', chapterName: id, status, promptText: 'p'.repeat(100), materialNames: [], strategySnapshot: null, createdAt: 1, completedAt: null, questionCount: 0, error: '', streamQuestionCount: 0, _expectedTotal: 1 })
    const queue = []
    for (let i = 0; i < 60; i++) queue.push(mk('hist' + i, 'completed'))
    queue.push(mk('pending1', 'pending'))
    st.aiTaskQueue = queue
    storage.setItem('qbao_user', JSON.stringify({ id: 'u1', username: 'a' }))
    storage.setItem('quizEngineState_cloud_u1', JSON.stringify(st))
    const ai = useAiStore()
    const data = useDataStore()
    // 直接调用 prune（store 初始化时的自动 resume 已把 pending1 交给 runner，
    // 无资料会失败收场——此处只验证剪枝语义本身）
    ai.pruneTaskQueue()
    const q = data.state.aiTaskQueue
    // 60 条历史被裁到最近 40 条以内（剩余为最新历史，顺序保持原序）
    expect(q.length).toBe(40)
    expect(q[0].id).toBe('hist21')
    expect(q.every((t) => t.id !== 'hist0' && t.id !== 'hist19')).toBe(true)
    // 进行中/排队任务永不清除：构造 60 条历史 + 1 条 pending 后直接调用
    data.state.aiTaskQueue = []
    for (let i = 0; i < 60; i++) data.state.aiTaskQueue.push(mk('h' + i, 'failed'))
    data.state.aiTaskQueue.push(mk('live1', 'pending'))
    ai.pruneTaskQueue()
    const q2 = data.state.aiTaskQueue
    expect(q2.length).toBe(41)
    expect(q2[q2.length - 1].id).toBe('live1')
    expect(q2[0].id).toBe('h20')
  })
})

describe('reconcileQueue 合并后重裁决 (round4.1)', () => {
  let storage
  beforeEach(() => {
    storage = makeLocalStorageStub({})
    globalThis.localStorage = storage
      globalThis.sessionStorage = makeSessionStorageStub()
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })
  afterEach(() => { delete globalThis.localStorage; delete globalThis.sessionStorage; vi.restoreAllMocks() })

  function setupSeed(queue, opts = {}) {
    const st = seedState()
    st.aiTaskQueue = queue
    if (opts.materials) st.chapterMaterials = opts.materials
    if (opts.aiConfig) st.aiConfig = { ...st.aiConfig, ...opts.aiConfig }
    storage.setItem('qbao_user', JSON.stringify({ id: 'u1', username: 'a' }))
    storage.setItem('quizEngineState_cloud_u1', JSON.stringify(st))
    const ai = useAiStore()
    const data = useDataStore()
    return { ai, data }
  }

  it('云端带回的 running 本地直连任务 → 明确失败（不再永远卡在排队）', async () => {
    const mk = (id, status, extra = {}) => ({ id, chapterId: 'c1', chapterName: '章一', status, promptText: 'p', materialNames: [], strategySnapshot: null, createdAt: 1, completedAt: null, questionCount: 0, error: '', streamQuestionCount: 0, _expectedTotal: 2, ...extra })
    const { data } = setupSeed([mk('stuck1', 'running')])
    const t = data.state.aiTaskQueue[0]
    expect(t.status).toBe('failed')
    expect(t.error).toContain('页面被刷新')
  })

  it('带 serverTaskId 的任务（服务端任务）→ 复用续跑直到完成，不被“刷新取消”逻辑误杀', { timeout: 20000 }, async () => {
    // migrateState 会把持久化的 running 重置为 pending+_wasRunning；服务端任务带
    // serverTaskId → resume 时复用服务端任务续跑（不重复创建、不误标失败）
    const mk = (id, status, extra = {}) => ({ id, chapterId: 'c1', chapterName: '章一', status, promptText: 'p', materialNames: [], strategySnapshot: null, createdAt: 1, completedAt: null, questionCount: 0, error: '', streamQuestionCount: 0, _expectedTotal: 2, ...extra })
    const { getAiServerTask } = await import('../services/aiApi')
    getAiServerTask.mockResolvedValue({ status: 'completed', result: { questions: [{ question: '服务端出的题', type: 'single', options: ['a', 'b', 'c', 'd'], answer: 0 }] } })
    const { ai, data } = setupSeed([mk('svc1', 'running', { serverTaskId: 'st_1' })], {
      materials: { c1: [{ id: 'm1', name: 'a.txt', size: 3, addedAt: 1 }] },
      aiConfig: { useServerQueue: true },
    })
    await vi.waitFor(() => {
      const t = data.state.aiTaskQueue[0]
      expect(['running', 'completed']).toContain(t.status)
      if (t.status === 'failed') throw new Error('服务端任务被误标失败: ' + t.error)
    }, { timeout: 8000, interval: 50 })
    await vi.waitFor(() => {
      const t = data.state.aiTaskQueue[0]
      expect(t.status).toBe('completed')
    }, { timeout: 8000, interval: 200 })
    const t = data.state.aiTaskQueue[0]
    expect(t.serverTaskId).toBe('st_1') // 复用，未重复创建
    expect(t.error).toBe('')
    expect(t.questionCount).toBe(1)
    // 完成后 runner 退出
    await vi.waitFor(() => { expect(ai.runnerActive).toBe(false) }, { timeout: 3000, interval: 50 })
  })

  it('pending 任务 → 启动 runner 自动续跑（不依赖用户重新点出题）', async () => {
    const mk = (id, status, extra = {}) => ({ id, chapterId: 'c1', chapterName: '章一', status, promptText: 'p', materialNames: [], strategySnapshot: null, createdAt: 1, completedAt: null, questionCount: 0, error: '', streamQuestionCount: 0, _expectedTotal: 2, ...extra })
    const { data } = setupSeed([mk('pend1', 'pending')])
    await vi.waitFor(() => {
      const t = data.state.aiTaskQueue[0]
      expect(['running', 'failed', 'completed']).toContain(t.status)
    }, { timeout: 2000, interval: 50 })
    // 无资料环境最终以失败收场（资料已被删除）——关键是从 pending 被接管执行
  })
})

describe('reconcileQueue 执行归属：同一任务只允许一个端执行 (round5.1)', () => {
  let storage
  beforeEach(() => {
    storage = makeLocalStorageStub({})
    globalThis.localStorage = storage
    globalThis.sessionStorage = makeSessionStorageStub()
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })
  afterEach(() => { delete globalThis.localStorage; delete globalThis.sessionStorage; vi.restoreAllMocks() })

  function seed(queue) {
    const st = seedState()
    st.aiTaskQueue = queue
    storage.setItem('qbao_user', JSON.stringify({ id: 'u1', username: 'a' }))
    storage.setItem('quizEngineState_cloud_u1', JSON.stringify(st))
  }
  function makeTask(over) {
    return { id: 't_x', chapterId: 'c1', chapterName: '章一', status: 'pending',
      promptText: 'p', materialNames: [], strategySnapshot: null,
      createdAt: Date.now(), completedAt: null, questionCount: 0, error: '',
      streamQuestionCount: 0, streamSetRef: null, _expectedTotal: 5, ...(over || {}) }
  }

  it('他端（不同 _owner）新 pending 任务 → 本端不执行，保持排队等属主', () => {
    seed([makeTask({ id: 't_foreign', _owner: 'o_other_device' })])
    const ai = useAiStore()
    const task = useDataStore().state.aiTaskQueue[0]
    expect(task.status).toBe('pending')
    expect(task.error).toBe('')
    expect(ai.runnerActive).toBe(false)
  })

  it('本端属主 pending 任务 → 正常进入执行（无资料以失败收场，状态流转证明归属生效）', async () => {
    seed([makeTask({ id: 't_mine', _owner: ownerId() })])
    const ai = useAiStore()
    await vi.waitFor(() => {
      const data = useDataStore()
      const task = data.state.aiTaskQueue[0]
      expect(['failed', 'completed']).toContain(task.status)
      if (task.status === 'failed') expect(task.error).toContain('资料')
      if (ai.runnerActive) throw new Error('runner 仍在运行')
    }, { timeout: 2500, interval: 50 })
  })

  it('他端失联（创建超 10 分钟）的 pending 任务 → 本端接管执行', async () => {
    const old = Date.now() - 11 * 60 * 1000
    seed([makeTask({ id: 't_stale', _owner: 'o_dead_device', createdAt: old })])
    const ai = useAiStore()
    await vi.waitFor(() => {
      const data = useDataStore()
      const task = data.state.aiTaskQueue[0]
      expect(['failed', 'completed']).toContain(task.status)
      if (ai.runnerActive) throw new Error('runner 仍在运行')
    }, { timeout: 2500, interval: 50 })
  })

  it('他端在途/待处理任务（云端带回）→ 本端不标记失败、不执行（本地优先合并不覆盖属主）', () => {
    seed([makeTask({ id: 't_run', _owner: 'o_other_device', status: 'running' })])
    useAiStore()
    const task = useDataStore().state.aiTaskQueue[0]
    // migrateState 会把 running 归一为 pending+_wasRunning；因非属主，不做失败标记
    expect(task.status).toBe('pending')
    expect(task.error).toBe('')
  })

  it('带 serverTaskId 的 pending 任务（任意端）→ 走复用轮询路径（不新建服务端任务、不本地调 AI）', async () => {
    seed([makeTask({ id: 't_server', _owner: 'o_other_device', serverTaskId: 99 })])
    const ai = useAiStore()
    // 复用路径会启动轮询（本测试 stub 无有效响应 → 最终以失败/完成收场，证明它被接管
    // 而非卡在 pending；关键在于不会 createAiServerTask/本地直连）
    await vi.waitFor(() => {
      const data = useDataStore()
      const task = data.state.aiTaskQueue[0]
      if (task.status === 'pending') throw new Error('未被接管')
    }, { timeout: 3000, interval: 50 })
    const task = useDataStore().state.aiTaskQueue[0]
    expect(['failed', 'completed']).toContain(task.status)
    // 未创建任何新服务端任务（createAiServerTask 未被调用）
    const { createAiServerTask } = await import('../services/aiApi')
    expect(createAiServerTask).not.toHaveBeenCalled()
  })
})