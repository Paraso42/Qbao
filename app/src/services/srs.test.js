import { describe, it, expect } from 'vitest'
import { updateSRSAfterExam } from './srs'
import { getQuestionId } from './questions'

describe('srs SM-2', () => {
  it('答对推进间隔，答错重置', () => {
    const state = { srsData: {} }
    const q1 = { type: 'single', answer: 0, question: '第一题?', options: ['1', '2'] }
    const q2 = { type: 'single', answer: 0, question: '第二题?', options: ['1', '2'] }
    updateSRSAfterExam(state, { setId: 'c1', questions: [q1, q2], userAnswers: [0, 1] })
    const id1 = getQuestionId('c1', q1)
    const id2 = getQuestionId('c1', q2)
    const first = state.srsData[id1]
    expect(first.interval).toBe(1)
    expect(first.repetitions).toBe(1)
    const second = state.srsData[id2]
    expect(second.interval).toBe(1)
    expect(second.repetitions).toBe(0)
    expect(second.easeFactor).toBeCloseTo(2.3)
  })
})
