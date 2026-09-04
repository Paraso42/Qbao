// aiServerTasks 服务端任务控制器（round4.2：历史保留）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../services/aiApi', () => ({
  listAiServerTasks: vi.fn(async () => []),
  cancelAiServerTask: vi.fn(async () => ({ ok: true })),
  fetchProvidersList: vi.fn(),
  aiTest: vi.fn(),
  aiUploadFiles: vi.fn(),
  aiStreamGenerate: vi.fn(),
  createAiServerTask: vi.fn(),
  getAiServerTask: vi.fn(),
}))

import { createServerTaskController } from './aiServerTasks'

describe('aiServerTasks 历史保留 (round4.2)', () => {
  let ctl
  let data

  function makeData(over = {}) {
    return {
      state: { aiTaskQueue: [], importedServerTaskIds: [], chapters: { c1: { id: 'c1' } }, ...(over.state || {}) },
      saveState: vi.fn(),
      createQuizSetForChapter: vi.fn(() => ({ id: 'newset' })),
      ...over,
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    data = makeData()
    const user = { isOnline: true, token: 't' }
    const ui = { toast: vi.fn() }
    ctl = createServerTaskController({ data, user, ui })
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('已完成且已导入的任务保留在列表（出题历史可查），不再被滤除', async () => {
    const { listAiServerTasks } = await import('../services/aiApi')
    data.state.importedServerTaskIds = ['st_completed_1']
    listAiServerTasks.mockResolvedValue([
      { id: 'st_completed_1', chapterId: 'c1', status: 'completed', createdAt: '2026-09-01T00:00:00Z', finishedAt: '2026-09-01T00:05:00Z', result: { questions: [{ question: 'a' }] } },
      { id: 'st_failed_1', chapterId: 'c1', status: 'failed', error: 'boom', createdAt: '2026-09-01T00:10:00Z' },
      { id: 'st_active_1', chapterId: 'c1', status: 'queued', createdAt: '2026-09-05T00:00:00Z' },
    ])
    await ctl.refreshServerTasks()
    expect(ctl.serverTasks.value.map((t) => t.id)).toEqual(['st_completed_1', 'st_failed_1', 'st_active_1'])
  })

  it('importServerTaskResult 导入后行保留（显示"已导入"），并记录 importedServerTaskIds 防重复', async () => {
    const st = {
      id: 'st_x', chapterId: 'c1', status: 'completed', createdAt: '2026-09-01T00:00:00Z',
      result: { questions: [{ question: '测试题目甲', type: 'single', options: ['a', 'b', 'c', 'd'], answer: 0 }] },
    }
    ctl.serverTasks.value.push(st) // 模拟列表已有该行
    const set = await ctl.importServerTaskResult(st)
    expect(set).toBeTruthy()
    expect(data.createQuizSetForChapter).toHaveBeenCalledTimes(1)
    expect(data.state.importedServerTaskIds).toContain('st_x')
    // 行仍保留在列表中（历史可查），重复导入被幂等拦截
    expect(ctl.serverTasks.value.some((t) => t.id === 'st_x')).toBe(true)
    expect(ctl.isServerTaskImported('st_x')).toBe(true)
    // 再次导入 → 幂等拦截，不再建 set
    const again = await ctl.importServerTaskResult(st)
    expect(again).toBeNull()
    expect(data.createQuizSetForChapter).toHaveBeenCalledTimes(1)
  })

  it('轮询发现服务端已完成且本地有对应任务：自动导入一次并同步本地状态', async () => {
    const { listAiServerTasks } = await import('../services/aiApi')
    data.state.aiTaskQueue = [{ id: 'local1', chapterId: 'c1', status: 'running', serverTaskId: 'st_done' }]
    listAiServerTasks.mockResolvedValue([
      { id: 'st_done', chapterId: 'c1', status: 'completed', createdAt: '2026-09-05T00:00:00Z', result: { questions: [{ question: '测试题目乙', type: 'single', options: ['a', 'b', 'c', 'd'], answer: 1 }] } },
    ])
    await ctl.refreshServerTasks()
    const local = data.state.aiTaskQueue[0]
    expect(local.status).toBe('completed')
    expect(data.createQuizSetForChapter).toHaveBeenCalledTimes(1)
    // 行保留在历史列表
    expect(ctl.serverTasks.value.some((t) => t.id === 'st_done')).toBe(true)
  })
})
