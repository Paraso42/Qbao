import { describe, it, expect } from 'vitest'
import { calcStats, getQuestionId, simpleHash, reclassifyTagsByRound, rebuildChapterAnswersFromSets } from './questions'

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

describe('rebuildChapterAnswersFromSets 题库答案对齐', () => {
  it('题库经过去重（少于轮次总和）时，按题干对齐各轮答案，位置不错位', () => {
    const q = (text, ans) => ({ question: text, type: 'single', options: ['a','b','c','d'], answer: ans })
    // 3 轮 × 15 题含 3 道重复题干；题库池去重后 42 题（round3 的真实场景）
    const ch = {
      questions: [q('Q1', 0), q('Q2', 1), q('Q3', 2), q('DUP1', 3), q('DUP2', 0), q('DUP3', 1)],
      quizSets: [
        { questions: [q('Q1', 0), q('DUP1', 3), q('Q2', 1)], userAnswers: [0, 3, undefined] },
        { questions: [q('DUP2', 0), q('Q3', 2), q('DUP1', 3)], userAnswers: [undefined, 2, undefined] },
        { questions: [q('DUP3', 1), q('Q3', 2), q('DUP2', 0)], userAnswers: [1, undefined, 0] },
      ],
    }
    rebuildChapterAnswersFromSets(ch)
    // Q1←set1(0)；Q2 无任何轮次作答→undefined；Q3←set2(2)；DUP1←set1(3)；
    // DUP2←set3(0)；DUP3←set3(1)
    expect(ch.userAnswers).toEqual([0, undefined, 2, 3, 0, 1])
    expect(ch.userAnswers).toHaveLength(ch.questions.length)
  })

  it('-1（跳过）与 undefined 视为未答，会由其他轮的答案补位；已答位置不被 -1 覆盖', () => {
    const q = (text) => ({ question: text, type: 'single', options: ['a','b'], answer: 0 })
    const ch = {
      questions: [q('A'), q('B'), q('C')],
      quizSets: [
        { questions: [q('A'), q('B')], userAnswers: [-1, 0] },
        { questions: [q('B'), q('C')], userAnswers: [1, undefined] },
      ],
    }
    rebuildChapterAnswersFromSets(ch)
    // B: 第一轮已答 0 占位，第二轮 1 不覆盖；A：-1 视为空 → C 位置由第二轮补？C 在第二轮未答 → 保持 undefined
    expect(ch.userAnswers[0]).toBeUndefined()
    expect(ch.userAnswers[1]).toBe(0)
    expect(ch.userAnswers[2]).toBeUndefined()
  })

  it('无 quizSets 或题库为空时安全无副作用', () => {
    const ch = { questions: [{ question: 'A' }], userAnswers: [5] }
    rebuildChapterAnswersFromSets(ch)
    expect(ch.userAnswers).toEqual([5])
    const ch2 = { questions: [], quizSets: [{ questions: [{ question: 'A' }], userAnswers: [1] }] }
    rebuildChapterAnswersFromSets(ch2)
    expect(ch2.userAnswers).toEqual([])
    rebuildChapterAnswersFromSets(null)
  })
})
