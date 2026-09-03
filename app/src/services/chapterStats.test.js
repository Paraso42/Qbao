import { describe, it, expect } from 'vitest'
import { chapterQuestionTotal, subjectQuestionTotal } from './chapterStats'

describe('chapterStats 题量口径', () => {
  it('无章节 → 0', () => {
    expect(chapterQuestionTotal(null)).toBe(0)
    expect(chapterQuestionTotal(undefined)).toBe(0)
  })

  it('有轮次（quizSets）时按轮次题目数求和', () => {
    const ch = {
      questions: [{ question: 'a' }, { question: 'b' }], // 去重池仅 2 题
      quizSets: [
        { questions: new Array(15).fill({ question: 'x' }) },
        { questions: new Array(15).fill({ question: 'y' }) },
        { questions: new Array(15).fill({ question: 'z' }) }
      ]
    }
    expect(chapterQuestionTotal(ch)).toBe(45)
  })

  it('轮次集合为空组按 0 计、空轮次数组按 0 计', () => {
    expect(chapterQuestionTotal({ quizSets: [{ questions: [] }] })).toBe(0)
    expect(chapterQuestionTotal({ quizSets: [] })).toBe(0)
  })

  it('无轮次的旧章节回退到题库数组长度', () => {
    const ch = { questions: new Array(42).fill({ question: 'q' }) }
    expect(chapterQuestionTotal(ch)).toBe(42)
    expect(chapterQuestionTotal({})).toBe(0)
  })

  it('科目总题数 = 各章节之和', () => {
    const state = {
      chapters: {
        c1: { quizSets: [{ questions: new Array(15).fill({}) }, { questions: new Array(15).fill({}) }] },
        c2: { questions: new Array(7).fill({}) },
        c3: null
      }
    }
    const subj = { chapterIds: ['c1', 'c2', 'c3'] }
    expect(subjectQuestionTotal(state, subj)).toBe(37)
    expect(subjectQuestionTotal(state, null)).toBe(0)
    expect(subjectQuestionTotal(null, subj)).toBe(0)
  })
})
