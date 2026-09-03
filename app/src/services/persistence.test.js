import { describe, it, expect, beforeEach, vi } from 'vitest'

// T12: saveState 写失败可见化 + 体积预警 + 瞬态字段恢复
// （node 环境无 localStorage，用内存 stub 模拟）

function makeLocalStorageStub() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)) },
    removeItem: (k) => { map.delete(k) },
    _map: map,
  }
}

describe('persistence.saveState (T12)', () => {
  let storage
  let hooks
  let mod

  beforeEach(() => {
    storage = makeLocalStorageStub()
    globalThis.localStorage = storage
    hooks = []
    // 每次重新加载模块（模块级 _persistWarn 状态隔离）
    vi.resetModules()
    return import('./persistence').then((m) => {
      mod = m
      m.setPersistWarningHook((msg, fatal) => hooks.push({ msg, fatal }))
    })
  })

  it('正常写入且恢复瞬态字段；v3.30 骨架化：落盘不含题目大字段', () => {
    const state = {
      quizSession: { questions: [] },
      chapterMaterials: { c1: [{ id: 'm1', name: 'a.pdf', data: 'BIGBLOB' }] },
      aiTaskQueue: [{ id: 't1', status: 'running', streamSetRef: { x: 1 } }],
      subjects: { s1: { id: 's1', name: '科目' } },
      chapters: {
        c1: { id: 'c1', name: '章节', strategy: { errPct: 20 }, questions: [{ id: 1, question: 'Q1' }], userAnswers: [0], quizSets: [] },
      },
      history: [{ id: 'h1', correct: 1 }],
    }
    const res = mod.saveState(state)
    expect(res.ok).toBe(true)
    // 瞬态字段恢复
    expect(state.quizSession).toEqual({ questions: [] })
    expect(state.aiTaskQueue[0].streamSetRef).toEqual({ x: 1 })
    expect(state.chapterMaterials.c1[0].data).toBe('BIGBLOB')
    // 落盘 = 骨架：不含题目/答案/quizSets/history/srsData，保留章节元数据
    const saved = JSON.parse(storage.getItem(mod.STORAGE_KEY))
    expect(saved.chapters.c1.questions).toBeUndefined()
    expect(saved.chapters.c1.userAnswers).toBeUndefined()
    expect(saved.chapters.c1.quizSets).toBeUndefined()
    expect(saved.chapters.c1.strategy.errPct).toBe(20)
    expect(saved.history).toBeUndefined()
    expect(saved.srsData).toBeUndefined()
    expect(saved.subjects.s1.name).toBe('科目')
    expect(saved.chapterMaterials.c1[0].data).toBeUndefined()
    expect(saved.quizSession).toBeNull()
    // 未登录时只写主键
    expect(storage.getItem(mod.STORAGE_KEY)).toBeTruthy()
  })

  it('活动会话同步持久化：答题进度刷新/关闭不丢（修复答题入口消失）', async () => {
    const state = {
      currentChapterId: 'c1',
      chapters: {
        c1: {
          id: 'c1', name: '章1', strategy: { errPct: 20 },
          questions: [{ id: 1, question: 'Q1' }, { id: 2, question: 'Q2' }],
          userAnswers: [0, undefined],
          currentQuizSetIdx: 0,
          quizSets: [{
            questions: [{ id: 1, question: 'Q1' }, { id: 2, question: 'Q2' }],
            userAnswers: [0, undefined],
            currentIdx: 1,
            createdAt: 123,
          }],
        },
      },
      subjects: {},
    }
    mod.saveState(state)
    // 活动会话键已写入
    const raw = storage.getItem(mod.ACTIVE_SESSION_KEY)
    expect(raw).toBeTruthy()
    const session = JSON.parse(raw)
    expect(session.cid).toBe('c1')
    expect(session.qsIdx).toBe(0)
    expect(session.userAnswers).toEqual([0, null]) // undefined → null（JSON 序列化）
    // 用骨架 state（无 quizSets）+ 活动会话键 → hydrate 回填答题入口
    const skeletonState = { currentChapterId: 'c1', chapters: { c1: { id: 'c1', name: '章1', strategy: { errPct: 20 } } }, subjects: {} }
    await mod.hydrateState(skeletonState)
    expect(skeletonState.chapters.c1.quizSets).toHaveLength(1)
    expect(skeletonState.chapters.c1.quizSets[0].questions).toHaveLength(2)
    // null → undefined：未答题目不能被统计为已答
    expect(skeletonState.chapters.c1.quizSets[0].userAnswers).toEqual([0, undefined])
    expect(skeletonState.chapters.c1.quizSets[0].currentIdx).toBe(1)
    expect(skeletonState.chapters.c1.currentQuizSetIdx).toBe(0)
    // 会话已存在时：活动会话覆盖答案/进度（IDB 数据可能旧）
    skeletonState.chapters.c1.quizSets[0].userAnswers = [undefined, undefined]
    storage.setItem(mod.ACTIVE_SESSION_KEY, JSON.stringify({ cid: 'c1', qsIdx: 0, questions: [{ id: 1 }, { id: 2 }], userAnswers: [1, null], currentIdx: 1 }))
    await mod.hydrateState(skeletonState)
    expect(skeletonState.chapters.c1.quizSets[0].userAnswers).toEqual([1, undefined])
    expect(skeletonState.chapters.c1.quizSets[0].currentIdx).toBe(1)
  })

  it('hasBigFields 能识别含题目/历史的大状态（旧数据迁移判定）', () => {
    expect(mod.hasBigFields({ chapters: { c1: { questions: [1, 2] } } })).toBe(true)
    expect(mod.hasBigFields({ chapters: { c1: { name: 'x' } } })).toBe(false)
    expect(mod.hasBigFields({ history: [1] })).toBe(true)
    expect(mod.hasBigFields({ srsData: { a: 1 } })).toBe(false)
    expect(mod.hasBigFields({ chapters: {} })).toBe(false)
  })

  it('QuotaExceededError → 可见告警 + ok:false，内存状态仍完整', () => {
    const state = { subjects: { s1: { id: 's1' } }, quizSession: { q: 1 } }
    storage.setItem = () => { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e }
    const res = mod.saveState(state)
    expect(res.ok).toBe(false)
    expect(hooks.length).toBeGreaterThan(0)
    expect(hooks[0].fatal).toBe(true)
    expect(hooks[0].msg).toContain('存储空间已满')
    // 瞬态字段仍恢复
    expect(state.quizSession).toEqual({ q: 1 })
  })

  it('超过 5MB 硬上限 → 不写盘、告警 ok:false', () => {
    const state = { subjects: { s1: { id: 's1', big: 'x'.repeat(5 * 1024 * 1024) } } }
    const res = mod.saveState(state)
    expect(res.ok).toBe(false)
    expect(hooks.some((h) => h.fatal && h.msg.includes('存储已满'))).toBe(true)
    expect(storage.getItem(mod.STORAGE_KEY)).toBeNull()
  })

  it('账号隔离：已登录时只读写账号键，绝不回退公共键（防串号）', () => {
    // 公共键里残留上一个账号的数据
    storage.setItem(mod.STORAGE_KEY, JSON.stringify({ subjects: { s1: { id: 's1', name: '主账号数据' } }, chapters: {} }))
    // 模拟已登录用户 A（id=7）
    storage.setItem('qbao_user', JSON.stringify({ id: 7, username: 'aaa' }))
    const st = mod.loadState()
    // 不读取公共键 → 空默认状态（而非主账号数据）
    expect(st.subjects.s1).toBeUndefined()
    expect(st.subjects).toEqual({})
    // 保存只写账号键，不写公共键
    const state = { subjects: { s2: { id: 's2', name: 'A 的数据' } }, chapterMaterials: {}, aiTaskQueue: [] }
    mod.saveState(state)
    expect(storage.getItem(mod.STORAGE_KEY)).toContain('主账号数据') // 公共键未被覆盖
    expect(JSON.parse(storage.getItem(mod.CLOUD_STORAGE_PREFIX + '7')).subjects.s2.name).toBe('A 的数据')
    // 再读：账号键优先
    expect(mod.loadState().subjects.s2.name).toBe('A 的数据')
  })

  it('超过 4MB 预警线 → 非致命告警，但仍正常写盘', () => {
    const state = { subjects: { s1: { id: 's1', big: 'x'.repeat(4.2 * 1024 * 1024) } } }
    const res = mod.saveState(state)
    expect(res.ok).toBe(true)
    expect(hooks.some((h) => !h.fatal && h.msg.includes('接近上限'))).toBe(true)
    expect(storage.getItem(mod.STORAGE_KEY)).toBeTruthy()
  })
})