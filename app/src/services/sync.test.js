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
})
