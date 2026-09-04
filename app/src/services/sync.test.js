import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mergeStates, createSyncEngine, getSyncPending, setSyncPending } from './sync'

// —— P1.2 引擎级测试基建：内存 localStorage + fetch mock ——
function makeLocalStorageStub(seed = {}) {
  const map = new Map(Object.entries(seed))
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)) },
    removeItem: (k) => { map.delete(k) },
    _map: map,
  }
}

// opts: { cloudState, cloudRev, conflictPutCount(前 N 次 PUT 返回 409) }
function installFetchMock(opts = {}) {
  const st = {
    cloudState: opts.cloudState || null,
    cloudRev: opts.cloudRev || 0,
    putCount: 0,
    getCount: 0,
    revCount: 0,
    putBodies: [],
    conflictLeft: opts.conflictPutCount || 0,
  }
  globalThis.fetch = async (url, options = {}) => {
    const p = String(url)
    const method = options.method || 'GET'
    if (p.endsWith('/data/rev')) {
      st.revCount++
      return { ok: true, status: 200, json: async () => ({ rev: st.cloudRev }) }
    }
    if (p.endsWith('/data') && method === 'PUT') {
      st.putCount++
      st.putBodies.push(options.body)
      if (st.conflictLeft > 0) {
        st.conflictLeft--
        return { ok: false, status: 409, json: async () => ({ error: '数据版本冲突' }) }
      }
      st.cloudRev++
      return { ok: true, status: 200, json: async () => ({ rev: st.cloudRev }) }
    }
    if (p.endsWith('/data')) {
      st.getCount++
      return { ok: true, status: 200, json: async () => ({ state_json: st.cloudState, rev: st.cloudRev }) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }
  return st
}

function baseState() {
  return {
    subjects: { s1: { id: 's1', name: '科目一', chapterIds: ['c1'] } },
    chapters: { c1: { id: 'c1', name: '章一', questions: [] } },
    history: [],
    lastScreen: 'start',
    aiConfig: {},
  }
}

async function makeEngine(storage) {
  const holder = { state: baseState() }
  let notified = []
  const engine = createSyncEngine({
    getState: () => holder.state,
    replaceState: (m) => { holder.state = m },
    isOnline: () => true,
    onStatus: () => {},
    notify: (msg) => notified.push(msg),
  })
  return { engine, holder, notified }
}

describe('sync keys 账号隔离 (P1.2)', () => {
  let storage
  beforeEach(() => {
    storage = makeLocalStorageStub({ qbao_token: 'tok', qbao_user: JSON.stringify({ id: 'u1', username: 'a' }) })
    globalThis.localStorage = storage
  })
  afterEach(() => { delete globalThis.localStorage })

  it('pending 标记按账号写入专属键，互不串扰', () => {
    setSyncPending(true)
    expect(storage.getItem('qbao_sync_pending_u_u1')).toBe('1')
    expect(storage.getItem('qbao_sync_pending')).toBeNull()
    // 切到 u2：看不到 u1 的 pending
    storage.setItem('qbao_user', JSON.stringify({ id: 'u2', username: 'b' }))
    expect(getSyncPending()).toBe(false)
    setSyncPending(true)
    expect(storage.getItem('qbao_sync_pending_u_u2')).toBe('1')
    // u1 遗留标记不被误清
    storage.setItem('qbao_user', JSON.stringify({ id: 'u1', username: 'a' }))
    expect(getSyncPending()).toBe(true)
    setSyncPending(false)
    expect(storage.getItem('qbao_sync_pending_u_u1')).toBeNull()
    expect(storage.getItem('qbao_sync_pending_u_u2')).toBe('1')
  })

  it('兼容旧版全局 pending 键（升级首启仍能补推）', () => {
    storage.removeItem('qbao_token')
    storage.removeItem('qbao_user')
    storage.setItem('qbao_sync_pending', '1')
    expect(getSyncPending()).toBe(true)
    // 登录后写新键 → 旧全局键被清除，防幽灵 pending
    storage.setItem('qbao_user', JSON.stringify({ id: 'u1' }))
    storage.setItem('qbao_token', 'tok')
    setSyncPending(true)
    expect(storage.getItem('qbao_sync_pending_u_u1')).toBe('1')
    expect(storage.getItem('qbao_sync_pending')).toBeNull()
  })
})

describe('createSyncEngine 写收敛 (P1.2)', () => {
  let storage
  beforeEach(() => {
    storage = makeLocalStorageStub({ qbao_token: 'tok', qbao_user: JSON.stringify({ id: 'u1', username: 'a' }) })
    globalThis.localStorage = storage
  })
  afterEach(() => { delete globalThis.localStorage; delete globalThis.fetch })

  it('空推跳过：内容未变的重复 flushSync 只产生一次 PUT', async () => {
    const fm = installFetchMock()
    const { engine } = await makeEngine(storage)
    engine.setSyncingReady(true)
    await engine.flushSync()
    expect(fm.putCount).toBe(1)
    // 无任何变化再 flush（轮询/可见性触发场景）→ 不再产生 PUT
    await engine.flushSync()
    await engine.flushSync()
    expect(fm.putCount).toBe(1)
    expect(getSyncPending()).toBe(false)
  })

  it('内容真实变化才触发下一次 PUT', async () => {
    const fm = installFetchMock()
    const { engine, holder } = await makeEngine(storage)
    engine.setSyncingReady(true)
    await engine.flushSync()
    expect(fm.putCount).toBe(1)
    // 本地作答变化（模拟答题保存）→ 推送
    holder.state.history.push({ id: 'h1', correct: 1 })
    await engine.flushSync()
    expect(fm.putCount).toBe(2)
    const pushed = JSON.parse(fm.putBodies[1])
    expect(pushed.state_json.history[0].id).toBe('h1')
    // 服务器 rev 前进后本地未变化 → 仍空推（轮询不产生写放大）
    await engine.flushSync()
    expect(fm.putCount).toBe(2)
  })

  it('启动门闩：就绪前不 PUT 且 pending 保留，就绪后补推一次', async () => {
    const fm = installFetchMock()
    const { engine, holder } = await makeEngine(storage)
    engine.setSyncingReady(false) // 模拟 boot：IDB 回填/云端恢复未完成
    holder.state.subjects.s1.name = '离线期间的修改'
    await engine.flushSync()
    expect(fm.putCount).toBe(0)
    expect(getSyncPending()).toBe(true)
    engine.setSyncingReady(true)
    await engine.resumePendingSync()
    expect(fm.putCount).toBe(1)
    const pushed = JSON.parse(fm.putBodies[0])
    expect(pushed.state_json.subjects.s1.name).toBe('离线期间的修改')
    expect(getSyncPending()).toBe(false)
  })

  it('rev 预检：云端有新写入 → 先拉全量合并（本地数据不丢）再带最新 rev 推送', async () => {
    const fm = installFetchMock({
      cloudRev: 7,
      cloudState: {
        subjects: {
          s1: { id: 's1', name: '科目一', chapterIds: ['c1'] },
          s9: { id: 's9', name: '另一台设备新增科目', chapterIds: [] },
        },
        chapters: { c1: { id: 'c1', name: '章一', questions: [] } },
        history: [],
        lastScreen: 'start',
        aiConfig: {},
      },
    })
    const { engine, holder } = await makeEngine(storage)
    engine.setRev(3) // 本地落后
    holder.state.subjects.s2 = { id: 's2', name: '本地新科目', chapterIds: [] }
    engine.setSyncingReady(true)
    await engine.flushSync()
    // 拉了一次云端，PUT 一次，payload 带云端最新 rev 且本地 s2 不丢
    expect(fm.getCount).toBe(1)
    expect(fm.putCount).toBe(1)
    const pushed = JSON.parse(fm.putBodies[0])
    expect(pushed.rev).toBe(7)
    expect(pushed.state_json.subjects.s2).toBeTruthy()
    expect(pushed.state_json.subjects.s9).toBeTruthy()
  })

  it('409 冲突：拉取 → 合并 → 以最新 rev 自动重推成功（toast 通知合并）', async () => {
    const fm = installFetchMock({
      cloudRev: 2,
      conflictPutCount: 1,
      cloudState: {
        subjects: { s1: { id: 's1', name: '科目一', chapterIds: ['c1'] } },
        chapters: {
          c1: {
            id: 'c1', name: '章一',
            questions: [{ id: 99, question: '云端并发出的题', type: 'single', options: ['a', 'b', 'c', 'd'], answer: 0, tag: 'x', strategy: 'new' }],
            userAnswers: [0],
            quizSets: [],
          },
        },
        history: [],
        lastScreen: 'start',
        aiConfig: {},
      },
    })
    const { engine, holder, notified } = await makeEngine(storage)
    engine.setRev(2)
    holder.state.chapters.c1.questions = [{ id: 1, question: '本地刚答的题', type: 'single', options: ['a', 'b', 'c', 'd'], answer: 1, tag: 'x', strategy: 'new' }]
    holder.state.chapters.c1.userAnswers = [1]
    engine.setSyncingReady(true)
    await engine.flushSync()
    // 第一次 PUT 409 → GET /data → 合并重推
    expect(fm.putCount).toBe(2)
    expect(fm.getCount).toBe(1)
    const pushed = JSON.parse(fm.putBodies[1])
    expect(pushed.rev).toBe(2)
    const qs = pushed.state_json.chapters.c1.questions.map((q) => q.question)
    expect(qs).toContain('本地刚答的题')
    expect(qs).toContain('云端并发出的题')
    expect(getSyncPending()).toBe(false)
    expect(notified.length).toBeGreaterThan(0)
    expect(notified.join('')).toContain('合并')
  })
})

describe('mergeStates', () => {
  it('本地优先标量、实体并集、历史按 id 去重', () => {
    const local = {
      currentSubjectId: 's2',
      lastScreen: 'start',
      subjects: { s2: { id: 's2', name: '本地', chapterIds: ['c1'] } },
      chapters: { c1: { id: 'c1', name: '章节1', questions: [] } },
      history: [{ id: 'h1' }, { id: 'h2' }]
    }
    const cloud = {
      currentSubjectId: 's1',
      lastScreen: 'history',
      subjects: { s1: { id: 's1', name: '云端', chapterIds: [] }, s2: { id: 's2', name: '旧', chapterIds: [] } },
      chapters: { c9: { id: 'c9', name: '云端独有', questions: [] } },
      history: [{ id: 'h1' }, { id: 'h9' }]
    }
    const m = mergeStates(local, cloud).state
    expect(m.currentSubjectId).toBe('s2')
    expect(m.subjects.s1).toBeTruthy()
    expect(m.subjects.s2.name).toBe('本地')
    expect(m.chapters.c1).toBeTruthy()
    expect(m.chapters.c9).toBeTruthy()
    expect(m.history.map((h) => h.id)).toEqual(['h1', 'h9', 'h2'])
  })

  it('章节级并集：多端并发出题不丢失任何一端题目', () => {
    const qA = { id: 1, question: 'A题目', type: 'single', options: ['a', 'b', 'c', 'd'], answer: 0, tag: 'x', strategy: 'new', explanation: '' }
    const qB = { id: 1, question: 'B题目', type: 'single', options: ['a', 'b', 'c', 'd'], answer: 1, tag: 'x', strategy: 'new', explanation: '' }
    const local = {
      chapters: {
        c1: {
          id: 'c1', name: '章节1',
          questions: [qA],
          userAnswers: [0],
          quizSets: [{ questions: [qA], userAnswers: [0], currentIdx: 0, createdAt: 1 }],
          currentQuizSetIdx: 0
        }
      }
    }
    const cloud = {
      chapters: {
        c1: {
          id: 'c1', name: '章节1',
          questions: [qB],
          userAnswers: [1],
          quizSets: [{ questions: [qB], userAnswers: [1], currentIdx: 0, createdAt: 2 }],
          currentQuizSetIdx: 0
        }
      }
    }
    const result = mergeStates(local, cloud)
    const m = result.state
    const ch = m.chapters.c1
    // 题库并集：两端题目都在，本地答案保留
    expect(ch.questions.map((q) => q.question).sort()).toEqual(['A题目', 'B题目'])
    expect(ch.quizSets.length).toBe(2)
    // 本地答案保留
    expect(ch.userAnswers[ch.questions.findIndex((q) => q.question === 'A题目')]).toBe(0)
    // 冲突新增数 = 合并后 - 云端原数量（云端 1 + quizSets 1 → 题库 2 + sets 2 = 4；before=2）
    expect(result.conflictAddedCount).toBe(2)
  })

  it('网页端旧缓存 + 云端桌面端新题：合并后能看到新章节（启动拉取场景）', () => {
    const q1 = { question: '桌面端生成的题', type: 'single', options: ['a', 'b', 'c', 'd'], answer: 1, tag: '网络', strategy: 'new' }
    const q2 = { question: '网页端本地旧题', type: 'single', options: ['a', 'b', 'c', 'd'], answer: 0, tag: '基础', strategy: 'new' }
    const local = {
      subjects: { s1: { id: 's1', name: '旧科目', chapterIds: ['c1'] } },
      chapters: { c1: { id: 'c1', name: '旧章节', questions: [q2], userAnswers: [0], quizSets: [] } },
      history: []
    }
    const cloud = {
      subjects: {
        s1: { id: 's1', name: '旧科目', chapterIds: ['c1'] },
        s2: { id: 's2', name: '桌面新科目', chapterIds: ['c2'] }
      },
      chapters: {
        c1: { id: 'c1', name: '旧章节', questions: [q1, q2], userAnswers: [0, 0], quizSets: [] },
        c2: { id: 'c2', name: '桌面新章节', questions: [q1], userAnswers: [0], quizSets: [] }
      },
      history: []
    }
    const m = mergeStates(local, cloud).state
    expect(m.subjects.s2).toBeTruthy()
    expect(m.chapters.c2).toBeTruthy()
    expect(m.chapters.c1.questions.length).toBe(2)
    expect(m.chapters.c1.questions.some((q) => q.question === '桌面端生成的题')).toBe(true)
    expect(m.chapters.c1.questions.some((q) => q.question === '网页端本地旧题')).toBe(true)
  })

  it('推送前合并：云端有桌面端新题时，本地旧状态推送不丢失云端题目（pull-before-push 场景）', () => {
    const cloudQ = { question: '桌面端新题', type: 'single', options: ['a', 'b', 'c', 'd'], answer: 0, tag: 'x', strategy: 'new' }
    const localQ = { question: '本地已修改旧题', type: 'single', options: ['a', 'b', 'c', 'd'], answer: 0, tag: 'x', strategy: 'new' }
    // 本地状态 = 网页端旧缓存（不含桌面端新题）
    const local = {
      chapters: { c1: { id: 'c1', name: '章节1', questions: [localQ], userAnswers: [0], quizSets: [] } }
    }
    // 云端 = 桌面端推送后的最新状态
    const cloud = {
      chapters: { c1: { id: 'c1', name: '章节1', questions: [localQ, cloudQ], userAnswers: [0, 1], quizSets: [] } }
    }
    const m = mergeStates(local, cloud).state
    // 合并后推送的必然是包含云端题目的并集 → 云端题不被覆盖丢
    expect(m.chapters.c1.questions.map((q) => q.question).sort()).toEqual(['本地已修改旧题', '桌面端新题'])
    expect(m.chapters.c1.userAnswers).toHaveLength(2)
  })

  it('T9 chapterMaterials 章节级并集：多端资料元数据不丢、按 id 去重', () => {
    const local = {
      chapterMaterials: {
        c1: [
          { id: 'pool_1', name: '本地池文件A.pdf', size: 10, addedAt: 1, _poolFile: true },
          { id: 'upload_2', name: '本地上传B.docx', size: 20, addedAt: 2 },
        ],
      },
    }
    const cloud = {
      chapterMaterials: {
        c1: [
          { id: 'pool_1', name: '云端池文件A.pdf', size: 10, addedAt: 1, _poolFile: true },
          { id: 'pool_9', name: '云端池文件C.pptx', size: 30, addedAt: 3, _poolFile: true },
        ],
        c2: [{ id: 'pool_1', name: '同一池文件分配到另一章节', size: 10, addedAt: 1, _poolFile: true }],
      },
    }
    const m = mergeStates(local, cloud).state
    // c1：云端在前、本地补漏，pool_1 去重保留云端条目
    expect(m.chapterMaterials.c1.map((x) => x.id)).toEqual(['pool_1', 'pool_9', 'upload_2'])
    // c2 只有云端
    expect(m.chapterMaterials.c2.map((x) => x.id)).toEqual(['pool_1'])
    // 同一 id 出现在不同章节 → 两章都保留（章节内去重，非全局）
    expect(m.chapterMaterials.c1[0].id).toBe('pool_1')
    expect(m.chapterMaterials.c2[0].id).toBe('pool_1')
  })

  it('T9 本地独有的章节资料在合并后保留（云端无 chapterMaterials 时）', () => {
    const local = {
      chapterMaterials: { c1: [{ id: 'upload_7', name: '本地独有.txt', size: 5, addedAt: 4 }] },
    }
    const cloud = { chapters: {} }
    const m = mergeStates(local, cloud).state
    expect(m.chapterMaterials.c1).toHaveLength(1)
    expect(m.chapterMaterials.c1[0].id).toBe('upload_7')
  })
})

describe('多端并发出题/答题合并 (round4)', () => {
  const q = (text, ans) => ({ question: text, type: 'single', options: ['a','b','c','d'], answer: ans })

  it('同轮次多端各自作答：mergeQuizSets 按题并集，任何一侧已答都不丢', () => {
    const local = {
      subjects: {}, chapters: {
        c1: {
          id: 'c1', name: '章一', questions: [q('Q1',0), q('Q2',1), q('Q3',2), q('Q4',3)],
          userAnswers: [0, undefined, 2, undefined], currentIdx: 0,
          quizSets: [{ questions: [q('Q1',0), q('Q2',1), q('Q3',2), q('Q4',3)], userAnswers: [0, undefined, 2, undefined], currentIdx: 1, createdAt: 1 }],
        },
      }, history: [], lastScreen: 'start', aiConfig: {},
    }
    const cloud = {
      subjects: {}, chapters: {
        c1: {
          id: 'c1', name: '章一', questions: [q('Q1',0), q('Q2',1), q('Q3',2), q('Q4',3)],
          userAnswers: [undefined, 1, undefined, 3], currentIdx: 0,
          quizSets: [{ questions: [q('Q1',0), q('Q2',1), q('Q3',2), q('Q4',3)], userAnswers: [undefined, 1, undefined, 3], currentIdx: 2, createdAt: 1 }],
        },
      }, history: [], lastScreen: 'start', aiConfig: {},
    }
    const m = mergeStates(local, cloud).state
    const set = m.chapters.c1.quizSets[0]
    // 并集：本地答的 Q1/Q3 + 云端答的 Q2/Q4 全部保留
    expect(set.userAnswers).toEqual([0, 1, 2, 3])
    // 题库答案同步对齐
    expect(m.chapters.c1.userAnswers).toEqual([0, 1, 2, 3])
  })

  it('同轮次去重合并后题库答案按题干对齐（池去重 ≠ 轮次和的场景）', () => {
    // 云端池去重后 [A,B,C]；云端两轮：{A,B} 已答 B、{C} 已答 C；
    // 本地同轮 {A,B} 已答 A → 合并后：池 3 题，答案按题干对齐为 [A:0, B:1, C:2]
    const local = {
      subjects: {}, chapters: {
        c1: {
          id: 'c1', name: '章一',
          questions: [q('A',0), q('B',1), q('A',0), q('C',2)],
          userAnswers: [0, undefined, undefined, undefined], currentIdx: 0,
          quizSets: [{ questions: [q('A',0), q('B',1)], userAnswers: [0, undefined], currentIdx: 0, createdAt: 1 }],
        },
      }, history: [], lastScreen: 'start', aiConfig: {},
    }
    const cloud = {
      subjects: {}, chapters: {
        c1: {
          id: 'c1', name: '章一',
          questions: [q('A',0), q('B',1), q('C',2)],
          userAnswers: [undefined, 1, 2], currentIdx: 0,
          quizSets: [
            { questions: [q('A',0), q('B',1)], userAnswers: [undefined, 1], currentIdx: 1, createdAt: 1 },
            { questions: [q('C',2)], userAnswers: [2], currentIdx: 0, createdAt: 2 },
          ],
        },
      }, history: [], lastScreen: 'start', aiConfig: {},
    }
    const m = mergeStates(local, cloud).state
    const ch = m.chapters.c1
    expect(ch.questions.map((x) => x.question)).toEqual(['A', 'B', 'C'])
    // 池按文本对齐：A←本地轮 0（云端该题未答）；B←云端 1；C←云端第二轮 2
    expect(ch.userAnswers).toEqual([0, 1, 2])
    // {A,B} 轮合并为 1 轮（答案并集 [0,1]），{C} 轮独立保留
    expect(ch.quizSets).toHaveLength(2)
    expect(ch.quizSets[0].userAnswers).toEqual([0, 1])
    expect(ch.quizSets[1].questions.map((x) => x.question)).toEqual(['C'])
  })

  it('本地未答、云端已答 → 合并后仍显示云端答案（进度不倒退）', () => {
    const local = {
      subjects: {}, chapters: {
        c1: {
          id: 'c1', name: '章一', questions: [q('A',0), q('B',1)],
          userAnswers: [undefined, undefined], currentIdx: 0,
          quizSets: [{ questions: [q('A',0), q('B',1)], userAnswers: [undefined, undefined], currentIdx: 0, createdAt: 1 }],
        },
      }, history: [], lastScreen: 'start', aiConfig: {},
    }
    const cloud = {
      subjects: {}, chapters: {
        c1: {
          id: 'c1', name: '章一', questions: [q('A',0), q('B',1)],
          userAnswers: [0, 1], currentIdx: 0,
          quizSets: [{ questions: [q('A',0), q('B',1)], userAnswers: [0, 1], currentIdx: 0, createdAt: 1 }],
        },
      }, history: [], lastScreen: 'start', aiConfig: {},
    }
    const m = mergeStates(local, cloud).state
    expect(m.chapters.c1.quizSets[0].userAnswers).toEqual([0, 1])
    expect(m.chapters.c1.userAnswers).toEqual([0, 1])
  })
})
