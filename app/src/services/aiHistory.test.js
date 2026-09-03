// P2.1 aiHistory 拆分模块单测（自 stores/ai.js 迁移后行为不变）
import { describe, it, expect } from 'vitest'
import { collectChapterHistory } from './aiHistory'

describe('aiHistory.collectChapterHistory (P2.1)', () => {
  const q = (question, tag, type = 'single', answer = 0) => ({ question, tag, type, options: ['a', 'b', 'c', 'd'], answer })

  it('聚合章节全部轮次的作答统计与错误标签 TOP10', () => {
    const state = {
      chapters: {
        c1: {
          quizSets: [
            { questions: [q('Q1', '极限'), q('Q2', '极限'), q('Q3', '导数')], userAnswers: [0, 1, 0] },
            { questions: [q('Q4', '极限')], userAnswers: [0] },
          ],
        },
      },
    }
    const h = collectChapterHistory(state, 'c1')
    expect(h.totalQuestions).toBe(4)
    expect(h.totalAnswered).toBe(4)
    expect(h.totalWrong).toBe(1) // Q2 答错
    expect(h.tagStats['极限'].total).toBe(3)
    expect(h.tagStats['极限'].correct).toBe(2)
    expect(h.tagStats['极限'].wrong).toBe(1)
    expect(h.tagStats['导数'].wrong).toBe(0)
    expect(h.topWrongTags.length).toBeGreaterThan(0)
    expect(h.topWrongTags[0]).toBe('极限')
  })

  it('未答/空状态不崩溃', () => {
    const state = { chapters: { c1: { quizSets: [] } } }
    const h = collectChapterHistory(state, 'c1')
    expect(h.totalQuestions).toBe(0)
    expect(h.totalWrong).toBe(0)
    expect(h.tagStats).toEqual({})
    const noCh = collectChapterHistory({ chapters: {} }, 'x')
    expect(noCh.totalQuestions).toBe(0)
  })

  it('没有 quizSets 的章节（纯题库导入）统计为 0', () => {
    const state = { chapters: { c1: { questions: [q('Q1', 'x')], userAnswers: [] } } }
    expect(collectChapterHistory(state, 'c1').totalQuestions).toBe(0)
  })
})
