import { describe, it, expect } from 'vitest'
import { mergeStates } from './sync'

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