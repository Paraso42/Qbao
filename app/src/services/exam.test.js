import { describe, it, expect } from 'vitest'
import { distributeCounts } from './exam'

describe('exam distribute', () => {
  it('按权重分配且总和守恒（最大余数法）', () => {
    const r = distributeCounts(10, ['a', 'b', 'c'], [20, 30, 50])
    expect(r.reduce((a, b) => a + b, 0)).toBe(10)
    expect(r[2]).toBe(5)
  })
  it('count 为 0 返回全零', () => {
    expect(distributeCounts(0, ['a', 'b'], [50, 50])).toEqual([0, 0])
  })
})
