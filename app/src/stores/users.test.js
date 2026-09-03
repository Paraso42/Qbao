// P1.4 users store 核心流转单测（文件池过滤/公告保存/备份历史上限）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('../services/usersApi', () => ({
  getUsers: vi.fn(async () => ({ users: [], total: 0 })),
  getUsersStats: vi.fn(async () => null),
  updateUser: vi.fn(async () => ({ ok: true })),
  getUser: vi.fn(async () => ({})),
  setUserBan: vi.fn(async () => ({})),
  getAllNotices: vi.fn(async () => []),
  createNotice: vi.fn(async () => ({ ok: true })),
  updateNotice: vi.fn(async () => ({ ok: true })),
  toggleNotice: vi.fn(async () => ({})),
  deleteNotice: vi.fn(async () => ({})),
  getUsersApi: undefined,
}))
vi.mock('../services/filesApi', () => ({
  listFiles: vi.fn(async () => ({ files: [] })),
  uploadFile: vi.fn(async () => ({ ok: true })),
  assignFile: vi.fn(async () => ({ file: {} })),
  unassignFile: vi.fn(async () => ({})),
  deleteFile: vi.fn(async () => ({})),
  extendFile: vi.fn(async () => ({})),
  uploadAvatar: vi.fn(async () => ({ user: {} })),
}))
vi.mock('../services/api', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual }
})
import { useUsersStore } from './users'
import { useUiStore } from './ui'
import * as filesApi from '../services/filesApi'
import * as usersApi from '../services/usersApi'

function makeLocalStorageStub(seed = {}) {
  const map = new Map(Object.entries(seed))
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)) },
    removeItem: (k) => { map.delete(k) },
    _map: map,
  }
}

function fakeFile(name, size) { return { name, size } }

describe('users store 核心流转 (P1.4)', () => {
  let storage
  beforeEach(() => {
    storage = makeLocalStorageStub({
      qbao_token: 'tok',
      qbao_user: JSON.stringify({ id: 'u1', username: 'alice', displayName: 'Alice', role: 'admin' }),
    })
    globalThis.localStorage = storage
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })
  afterEach(() => { delete globalThis.localStorage })

  it('uploadFiles：类型/大小白名单过滤，非法文件跳过不调上传', async () => {
    const users = useUsersStore()
    const ui = useUiStore()
    const res = await users.uploadFiles([
      fakeFile('evil.exe', 1024),
      fakeFile('big.pdf', 30 * 1024 * 1024),
      fakeFile('notes.md', 2048),
    ])
    expect(res).toEqual({ success: 1, fail: 2 })
    expect(filesApi.uploadFile).toHaveBeenCalledTimes(1)
    const uploaded = filesApi.uploadFile.mock.calls[0][0]
    expect(uploaded.name).toBe('notes.md')
    // 两条错误提示（类型不支持 + 超 20MB）
    const errs = ui.toasts.filter((t) => t.type === 'err').map((t) => t.message)
    expect(errs.some((m) => m.includes('类型不支持'))).toBe(true)
    expect(errs.some((m) => m.includes('超过 20MB'))).toBe(true)
  })

  it('saveNotice：duration 下限 2000ms，link/expire_at 附带；无 id 走创建', async () => {
    const users = useUsersStore()
    const ok = await users.saveNotice({ content: '系统维护', type: 'notice', durationSeconds: 0.3 })
    expect(ok).toBe(true)
    expect(usersApi.createNotice).toHaveBeenCalledWith({
      content: '系统维护', type: 'notice', duration: 2000,
    })
    const ok2 = await users.saveNotice({ id: 'n1', content: '更新', type: 'update', durationSeconds: 4.5, link: 'https://x.example', expire_at: '2099-01-01' })
    expect(ok2).toBe(true)
    expect(usersApi.updateNotice).toHaveBeenCalledWith('n1', {
      content: '更新', type: 'update', duration: 4500, link: 'https://x.example', expire_at: '2099-01-01',
    })
  })

  it('restoreFromText：migrate 后整体回档并修正当前科目/章节指针', () => {
    const users = useUsersStore()
    const state = {
      subjects: { s1: { id: 's1', name: '科目', chapterIds: ['c1'], collapsed: false } },
      chapters: { c1: { id: 'c1', name: '章', strategy: null } },
      currentSubjectId: null,
      currentChapterId: null,
      history: [],
    }
    const res = users.restoreFromText(JSON.stringify({ backupVersion: 8, state }))
    expect(res.ok).toBe(true)
    // 通过重新读 localStorage 骨架验证回档已落盘（seed 登录态 → 账号专属键）
    const saved = JSON.parse(storage.getItem('quizEngineState_cloud_u1'))
    expect(saved.subjects.s1.name).toBe('科目')
    expect(saved.currentSubjectId).toBe('s1')
  })

  it('restoreFromText：非法备份报错不落盘', () => {
    const users = useUsersStore()
    const res = users.restoreFromText('{"foo":1}')
    expect(res.ok).toBe(false)
    expect(res.error).toBeTruthy()
    expect(storage.getItem('quizEngineState_v7')).toBeNull()
  })
})
