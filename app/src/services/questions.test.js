import { describe, it, expect } from 'vitest'
import { calcStats, getQuestionId, simpleHash, reclassifyTagsByRound } from './questions'

describe('questions', () => {
  it('calcStats 统计客观/主观/错误', () => {
    const as = {
      questions: [
        { type: 'single', answer: 0 },
        { type: 'judge', answer: 1 },
        { type: 'term' },
        { type: 'short' }
      ],
      userAnswers: [0, 0, '答了', undefined]
    }
    const s = calcStats(as)
    expect(s.total).toBe(4)
    expect(s.answered).toBe(3)
    expect(s.objTotal).toBe(2)
    expect(s.objCorrect).toBe(1)
    expect(s.wrongCount).toBe(1)
    expect(s.subjCount).toBe(1)
  })

  it('getQuestionId 由章节与题干哈希组成且稳定', () => {
    const a = getQuestionId('ch_1', { question: '1+1=?', type: 'single' })
    const b = getQuestionId('ch_1', { question: '1+1=?', type: 'judge' })
    expect(a).toBe(b)
    expect(a.startsWith('ch_1:')).toBe(true)
  })

  it('reclassifyTagsByRound 本轮有错进 error、全对进 review、未答完保留', () => {
    const s = {
      errorTags: ['t1'], reviewTags: ['t2'], newTopicTags: ['t3'], tagMeta: {},
      _roundTagStats: {
        t1: { total: 2, correct: 1, wrong: 1 },
        t2: { total: 2, correct: 2, wrong: 0 },
        t3: { total: 2, correct: 0, wrong: 0 }
      }
    }
    reclassifyTagsByRound(s)
    expect(s.errorTags).toContain('t1')
    expect(s.reviewTags).toContain('t2')
    expect(s.newTopicTags).toContain('t3')
  })

  it('simpleHash 稳定', () => {
    expect(simpleHash('hello')).toBe(simpleHash('hello'))
  })
})
