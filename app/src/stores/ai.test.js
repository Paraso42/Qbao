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
import { useUiStore } from './ui'
import { STORAGE_KEY } from '../services/persistence'
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
    history: [], lastScreen: 'start', srsData: {}, generatedExams: {},
    achievements: { unlocked: [], history: [] }, settings: { darkMode: false },
    aiConfig: { provider: 'ecnu', model: 'ecnu-plus', providerKeys: undefined, apiKeySet: false, systemPrompt: '' },
    aiTaskQueue: [], importedServerTaskIds: [], chapterMaterials: {},
  }
}

describe('ai store 核心流转 (P1.4/P1.3 路径)', () => {
  let storage
  beforeEach(() => {
    storage = makeLocalStorageStub({})
    globalThis.localStorage = storage
    setActivePinia(createPinia())
    storage.setItem(STORAGE_KEY, JSON.stringify(seedState()))
    useDataStore()
    vi.clearAllMocks()
  })
  afterEach(() => { delete globalThis.localStorage; vi.restoreAllMocks() })

  function setup() {
    return { ai: useAiStore(), ui: useUiStore() }
  }

  it('saveAiConfig：模型记忆 + 密钥走 aiKeys 存储（state 不含明文）+ apiKeySet 置位', () => {
    const { ai } = setup()
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
    const { ai } = setup()
    const data = useDataStore()
    ai.saveAiConfig({ provider: 'ecnu', apiKey: 'sk-e' })
    expect(data.state.aiConfig.apiKeySet).toBe(true)
    ai.clearApiKey('ecnu')
    expect(getAiApiKey('ecnu')).toBe('')
    expect(data.state.aiConfig.apiKeySet).toBe(false)
  })

  it('enqueueGenerate 前置校验：无复习资料拒绝入队（toast 提示）', () => {
    const { ai, ui } = setup()
    ai.enqueueGenerate('c1', { single: 2, judge: 0, term: 0, short: 0 })
    const data = useDataStore()
    expect(data.state.aiTaskQueue).toHaveLength(0)
    expect(ui.toasts.some((t) => t.message.includes('请先上传复习资料'))).toBe(true)
  })

  it('hasTaskForChapter：章节已有 pending/running 任务时防重复入队（K1 守卫）', () => {
    const { ai } = setup()
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
    const { ai } = setup()
    const data = useDataStore()
    data.state.aiConfig.provider = 'ecnu'
    await expect(ai.testConnection()).rejects.toThrow('请先保存 API 密钥')
  })

  it('rememberModel/recalledModel 按 provider 记忆模型', () => {
    const { ai } = setup()
    const data = useDataStore()
    data.state.aiConfig.modelByProvider = undefined
    expect(ai.recalledModel('ecnu')).toBe('ecnu-plus') // 默认回退
    ai.rememberModel('gemini', 'gemini-2.0-flash')
    expect(ai.recalledModel('gemini')).toBe('gemini-2.0-flash')
  })
})
