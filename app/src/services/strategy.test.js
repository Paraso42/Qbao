import { describe, it, expect } from 'vitest'
import { adjustStrategyPct, applyDualSlider, computeStrategyTargets, generatePromptText } from './strategy'
import { getChStrategy } from './persistence'

describe('strategy pct', () => {
  it('adjustStrategyPct 向右增减且总和恒为100', () => {
    const s = { errPct: 20, reviewPct: 50, newPct: 30 }
    const pcts = adjustStrategyPct(s, 0, 40)
    expect(pcts[0] + pcts[1] + pcts[2]).toBe(100)
    expect(s.errPct).toBe(40)
    expect(s.reviewPct).toBe(30)
  })

  it('applyDualSlider 由累积值计算三段占比', () => {
    const s = {}
    const r = applyDualSlider(s, 30, 80)
    expect(r).toEqual({ err: 30, review: 50, newP: 20 })
    expect(s.newPct).toBe(20)
  })
})

describe('computeStrategyTargets 配额换算 (round4.2)', () => {
  it('常规比例：err/review 取整、new 取余且总数守恒', () => {
    const t = computeStrategyTargets(10, 20, 50, ['t1'], ['t2'])
    expect(t.error + t.review + t.new).toBe(10)
    expect(t.error).toBe(2)
    expect(t.review).toBe(5)
    expect(t.new).toBe(3)
    expect(t.errMerged).toBe(false)
    expect(t.revMerged).toBe(false)
  })

  it('取整溢出不为负：5 题 错题50%+复习50%（无配额给 new）→ 全部落到 err/review 且无负数', () => {
    const t = computeStrategyTargets(5, 50, 50, ['e1'], ['r1'])
    expect(t.error + t.review + t.new).toBe(5)
    expect(t.error).toBe(3)
    expect(t.review).toBe(2)
    expect(t.new).toBe(0)
    expect(t.new).toBeGreaterThanOrEqual(0)
  })

  it('无错题标签：err 配额并入 new（errMerged），总数守恒', () => {
    const t = computeStrategyTargets(10, 30, 30, [], ['r1'])
    expect(t.error).toBe(0)
    expect(t.review).toBe(3)
    expect(t.new).toBe(7)
    expect(t.errMerged).toBe(true)
    expect(t.revMerged).toBe(false)
  })

  it('错题与复习标签均为空：全部并入 new', () => {
    const t = computeStrategyTargets(8, 25, 25, null, undefined)
    expect(t.error).toBe(0)
    expect(t.review).toBe(0)
    expect(t.new).toBe(8)
  })

  it('0 题或全 0 比例：全 0 安全', () => {
    expect(computeStrategyTargets(0, 30, 30, ['e'], ['r']).new).toBe(0)
    const t = computeStrategyTargets(10, 0, 0, ['e'], ['r'])
    expect(t.error).toBe(0); expect(t.review).toBe(0); expect(t.new).toBe(10)
  })
})

describe('generatePromptText 提示词 (round4.2)', () => {
  function stateWith(patch = {}) {
    const state = {
      chapters: {
        c1: { id: 'c1', name: '章', questions: [], quizSets: [], strategy: { typeCounts: { single: 3, judge: 2, term: 0, short: 0 }, errPct: 60, reviewPct: 40, newPct: 0, errorTags: [], reviewTags: [], newTopicTags: [], tagMeta: {} } },
      },
    }
    Object.assign(state.chapters.c1.strategy, patch)
    return state
  }

  it('无任何标签时：配额全并入新考点，提示词不出现负数道数', () => {
    const text = generatePromptText(stateWith(), 'c1')
    expect(text).toContain('新考点探索 (new)：5 道')
    // 不出现负值道数（-1 道等）
    expect(text).not.toMatch(/\(error\)：-\d/)
    expect(text).not.toMatch(/\(review\)：-\d/)
    expect(text).not.toMatch(/\(new\)：-\d/)
    expect(text).toContain('已并入')
    expect(text).toContain('避免重复')
    expect(text).not.toContain('(error)：') // errPct60% 因无标签被并入（不出现 error 行）
  })

  it('有错题/复习标签：按比例分配且提示词含标签清单', () => {
    const state = stateWith({ errorTags: ['牛顿定律'], reviewTags: ['电场'], tagMeta: { '牛顿定律': { totalQ: 4, correct: 1 }, '电场': { totalQ: 2, correct: 2 } } })
    const text = generatePromptText(stateWith({ errorTags: ['牛顿定律'], reviewTags: ['电场'], tagMeta: { '牛顿定律': { totalQ: 4, correct: 1 }, '电场': { totalQ: 2, correct: 2 } } }), 'c1')
    expect(text).toContain('错题回顾 (error)：3 道')
    expect(text).toContain('滚动复习 (review)：2 道')
    expect(text).toContain('错题标签：牛顿定律')
    expect(text).toContain('正确率25%')
    // new 配额为 0 时不出 new 行；任何分配行都不出现负数
    expect(text).not.toMatch(/\(error\)：-\d/)
    expect(text).not.toMatch(/\(review\)：-\d/)
    expect(text).not.toContain('(new)：')
  })
})
