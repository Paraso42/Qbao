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
    const m = mergeStates(local, cloud)
    expect(m.currentSubjectId).toBe('s2')
    expect(m.subjects.s1).toBeTruthy()
    expect(m.subjects.s2.name).toBe('本地')
    expect(m.chapters.c1).toBeTruthy()
    expect(m.chapters.c9).toBeTruthy()
    expect(m.history.map((h) => h.id)).toEqual(['h1', 'h9', 'h2'])
  })
})
