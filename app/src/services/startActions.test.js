import { describe, it, expect } from 'vitest'
import { derivePrimaryAction, GENERATE_STATE, GENERATING_STATE, ANSWER_STATE } from './startActions'

describe('startActions.derivePrimaryAction（v3.36 单槽位状态机）', () => {
  it('无轮次且可生成 → 开始出题可点', () => {
    const a = derivePrimaryAction({ setTotal: 0, setAnswered: 0, canGenerate: true })
    expect(a.state).toBe(GENERATE_STATE)
    expect(a.label).toBe('开始出题')
    expect(a.enabled).toBe(true)
    expect(a.reason).toBe('')
  })

  it('无轮次且不可生成 → 开始出题灰化并显示原因', () => {
    const a = derivePrimaryAction({ setTotal: 0, canGenerate: false, blockReason: '请先上传复习资料' })
    expect(a.state).toBe(GENERATE_STATE)
    expect(a.label).toBe('开始出题')
    expect(a.enabled).toBe(false)
    expect(a.reason).toContain('请先上传复习资料')
  })

  it('出题中（任务在队列）→ 同槽位灰化「出题中…」', () => {
    const a = derivePrimaryAction({ setTotal: 0, hasTask: true, canGenerate: false })
    expect(a.state).toBe(GENERATING_STATE)
    expect(a.label).toBe('出题中…')
    expect(a.enabled).toBe(false)
    expect(a.reason).toContain('开始答题')
  })

  it('出好且未答完 → 同槽位变「开始答题」主按钮（0 已答）', () => {
    const a = derivePrimaryAction({ setTotal: 15, setAnswered: 0, canGenerate: false })
    expect(a.state).toBe(ANSWER_STATE)
    expect(a.label).toBe('开始答题')
    expect(a.enabled).toBe(true)
  })

  it('出好且部分已答 → 仍为「开始答题」（续答该轮）', () => {
    const a = derivePrimaryAction({ setTotal: 15, setAnswered: 7 })
    expect(a.state).toBe(ANSWER_STATE)
    expect(a.label).toBe('开始答题')
    expect(a.enabled).toBe(true)
  })

  it('本轮全部答完 → 回到「开始出题」（可生成下一轮时可点）', () => {
    const a = derivePrimaryAction({ setTotal: 15, setAnswered: 15, canGenerate: true })
    expect(a.state).toBe(GENERATE_STATE)
    expect(a.label).toBe('开始出题')
    expect(a.enabled).toBe(true)
  })

  it('答完且无资料 → 灰化并给出原因', () => {
    const a = derivePrimaryAction({ setTotal: 15, setAnswered: 15, canGenerate: false, blockReason: '请先上传复习资料（下方「复习资料管理」）' })
    expect(a.state).toBe(GENERATE_STATE)
    expect(a.enabled).toBe(false)
    expect(a.reason).toContain('复习资料')
  })

  it('异常输入保守处理：负数/NaN 不进入答题态', () => {
    const a = derivePrimaryAction({ setTotal: Number.NaN, setAnswered: -3 })
    expect(a.state).toBe(GENERATE_STATE)
    expect(a.enabled).toBe(false)
  })
})
