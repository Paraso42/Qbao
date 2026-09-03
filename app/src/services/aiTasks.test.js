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

  it('applyStrategyCompliance：按 strategySnapshot 期望分布核算 ok/actual', () => {
    const task = {
      strategySnapshot: {
        typeCounts: { single: 5, judge: 5, term: 0, short: 0 },
        errPct: 60, reviewPct: 20, newPct: 20,
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
    expect(task.strategyCompliance.ok).toBe(true)
    // 空题目不核算
    const t2 = { strategySnapshot: task.strategySnapshot }
    applyStrategyCompliance(t2, [])
    expect(t2.strategyCompliance).toBeUndefined()
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
