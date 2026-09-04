// P2.1 aiTasks 拆分模块单测（生成核心纯逻辑）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { normalizeQuestions, applyStrategyCompliance, processPoolDiagnostics } from './aiTasks'

describe('aiTasks 拆分纯逻辑 (P2.1)', () => {
  it('normalizeQuestions：补 id、剔空题干', () => {
    const out = normalizeQuestions([
      { question: '有效题A', type: 'single' },
      { question: '  ', type: 'single' },
      { question: 'A', type: 'single' }, // 长度 ≤2 被过滤（与迁移前一致）
      { id: 9, question: '有效题B', type: 'judge' },
    ])
    expect(out).toHaveLength(2)
    expect(out[0].id).toBe(1)
    expect(out[1].id).toBe(9)
  })

  it('applyStrategyCompliance：按 strategySnapshot（含标签）期望分布核算 ok/actual', () => {
    const task = {
      strategySnapshot: {
        typeCounts: { single: 5, judge: 5, term: 0, short: 0 },
        errPct: 60, reviewPct: 20, newPct: 20,
        errorTags: ['e1'], reviewTags: ['r1'], newTopicTags: [], tagMeta: {},
      },
    }
    const questions = [
      { question: 'a', strategy: 'error' }, { question: 'b', strategy: 'error' },
      { question: 'c', strategy: 'error' }, { question: 'd', strategy: 'review' },
      { question: 'e', strategy: 'new' }, { question: 'f', strategy: 'error' },
    ]
    applyStrategyCompliance(task, questions)
    expect(task.strategyCompliance.actual).toEqual({ error: 4, review: 1, new: 1, unlabeled: 0 })
    // 期望：err 6(review 2,new 2)=10 题 → 与 actual 差 ≤2 → ok
    expect(task.strategyCompliance.expected).toEqual({ error: 6, review: 2, new: 2 })
    expect(task.strategyCompliance.ok).toBe(true)
    // 空题目不核算
    const t2 = { strategySnapshot: task.strategySnapshot }
    applyStrategyCompliance(t2, [])
    expect(t2.strategyCompliance).toBeUndefined()
  })

  it('applyStrategyCompliance：无标签时配额并入 new（与提示词同口径）', () => {
    const task = {
      strategySnapshot: {
        typeCounts: { single: 5, judge: 5, term: 0, short: 0 },
        errPct: 60, reviewPct: 20, newPct: 20,
        // 无 errorTags/reviewTags
      },
    }
    const questions = [
      { question: 'a', strategy: 'new' }, { question: 'b', strategy: 'new' },
      { question: 'c', strategy: 'new' }, { question: 'd', strategy: 'new' },
      { question: 'e', strategy: 'new' }, { question: 'f', strategy: 'new' },
      { question: 'g', strategy: 'new' }, { question: 'h', strategy: 'new' },
      { question: 'i', strategy: 'new' }, { question: 'j', strategy: 'new' },
    ]
    applyStrategyCompliance(task, questions)
    // 10 题全部按 new 期望（60%/20% 配额因无标签并入）
    expect(task.strategyCompliance.expected).toEqual({ error: 0, review: 0, new: 10 })
    expect(task.strategyCompliance.ok).toBe(true)
    const bad = { strategySnapshot: task.strategySnapshot }
    const qs2 = [{ question: 'x', strategy: 'error' }]
    applyStrategyCompliance(bad, qs2)
    expect(bad.strategyCompliance.ok).toBe(false)
  })

  it('processPoolDiagnostics：失败告警与成功计数只跑一次', () => {
    const task = {
      _poolFilesStatus: [
        { name: 'a.pdf', extracted: true, empty: false, error: '' },
        { name: 'b.pdf', extracted: false, empty: false, error: '解析失败' },
        { name: 'c.pdf', extracted: true, empty: true, error: '' },
      ],
    }
    processPoolDiagnostics(task)
    expect(task.poolFilesTotal).toBe(3)
    expect(task.poolFilesUsed).toBe(1)
    expect(task.poolFileWarnings).toHaveLength(2)
    expect(task._poolFilesStatus).toBeUndefined()
    // 二次调用（无 _poolFilesStatus）不再改动
    const before = JSON.stringify({ poolFilesTotal: task.poolFilesTotal, poolFileWarnings: task.poolFileWarnings })
    processPoolDiagnostics(task)
    expect(JSON.stringify({ poolFilesTotal: task.poolFilesTotal, poolFileWarnings: task.poolFileWarnings })).toBe(before)
  })
})
