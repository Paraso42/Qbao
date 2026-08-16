import { describe, it, expect } from 'vitest'
import { adjustStrategyPct, applyDualSlider } from './strategy'

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
