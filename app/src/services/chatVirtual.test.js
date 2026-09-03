// P2.4 聊天窗口化渲染纯函数单测
import { describe, it, expect } from 'vitest'
import { computeChatWindow, msgEstimateHeight } from './chatVirtual'

describe('chatVirtual 窗口计算 (P2.4)', () => {
  it('msgEstimateHeight：按类型放大估算', () => {
    expect(msgEstimateHeight({ msg_type: 'text' }, 84)).toBe(84)
    expect(msgEstimateHeight({ msg_type: 'image' }, 84)).toBe(202)
    expect(msgEstimateHeight({ msg_type: 'quiz_share' }, 84)).toBe(160)
    expect(msgEstimateHeight({ msg_type: 'file' }, 84)).toBe(118)
    expect(msgEstimateHeight(null, 84)).toBe(84)
  })

  it('1000 条消息仅渲染可视窗口（±buf），其余以 spacer 占位', () => {
    const N = 1000
    const heights = new Array(N).fill(84)
    const w = computeChatWindow({ total: N, heights, gap: 12, scrollTop: 40000, viewH: 600, buf: 300 })
    // 40000px 高度对应约 (40000/96) ≈ 416 行附近
    expect(w.startIdx).toBeGreaterThan(0)
    expect(w.endIdx).toBeLessThan(N)
    const rendered = w.endIdx - w.startIdx
    // 窗口 ≈ (600+600)/96 + 少量边界 ≈ 12~14 条
    expect(rendered).toBeGreaterThan(10)
    expect(rendered).toBeLessThan(30)
    // 头尾占位总和 + 渲染内容高度 ≈ 总高度
    const estTotal = N * (84 + 12) - 12
    const renderedH = heights.slice(w.startIdx, w.endIdx).reduce((a, b) => a + b, 0) + (w.endIdx - w.startIdx - 1) * 12
    expect(w.topPad + renderedH + w.botPad).toBe(estTotal)
  })

  it('顶部/底部窗口边界正确', () => {
    const heights = new Array(50).fill(96)
    // 顶部
    const top = computeChatWindow({ total: 50, heights, gap: 12, scrollTop: 0, viewH: 600, buf: 300 })
    expect(top.startIdx).toBe(0)
    expect(top.topPad).toBe(0)
    // 底部（大幅滚动）
    const total = 50 * (96 + 12) - 12
    const bot = computeChatWindow({ total: 50, heights, gap: 12, scrollTop: total, viewH: 600, buf: 300 })
    expect(bot.endIdx).toBe(50)
    expect(bot.botPad).toBe(0)
    expect(bot.topPad).toBeGreaterThan(0)
  })

  it('空列表/小列表安全', () => {
    expect(computeChatWindow({ total: 0, heights: [], gap: 12, scrollTop: 0, viewH: 600, buf: 300 })).toEqual({ startIdx: 0, endIdx: 0, topPad: 0, botPad: 0 })
    const w = computeChatWindow({ total: 1, heights: [100], gap: 12, scrollTop: 0, viewH: 600, buf: 0 })
    expect(w).toEqual({ startIdx: 0, endIdx: 1, topPad: 0, botPad: 0 })
  })
})
