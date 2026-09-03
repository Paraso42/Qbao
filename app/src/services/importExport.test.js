// P3.2 题库导入导出纯逻辑单测
import { describe, it, expect } from 'vitest'
import { parseJsonQuestions, parseCsvQuestions, dedupeQuestions, questionSignature, exportQuestionsJson, normalizeQuestionType } from './importExport'

describe('importExport (P3.2)', () => {
  it('parseJsonQuestions：兼容代码块包裹/过滤空题干/中文题型', () => {
    const raw = '\n\n```json\n[{"type":"单选","question":"1+1=?","options":["1","2"],"answer":1},{"type":"judge","question":"地球是圆的","options":["正确","错误"],"answer":0},{"type":"single","question":"   ","options":["a","b"],"answer":0},{"type":"short","question":"简述原理"}]\n```'
    const out = parseJsonQuestions(raw)
    expect(out).toHaveLength(3)
    expect(out[0].type).toBe('single')
    expect(out[0].question).toBe('1+1=?')
    expect(out[1].type).toBe('judge')
  })

  it('parseJsonQuestions：非法结构抛可读错误', () => {
    expect(() => parseJsonQuestions('{"a":1}')).toThrow('必须是数组')
    expect(() => parseJsonQuestions('[{"type":"single"}]')).toThrow('缺 question')
    expect(() => parseJsonQuestions('[{"type":"single","question":"x","options":[]}]')).toThrow('缺 options')
    expect(() => parseJsonQuestions('[{"type":"weird","question":"x"}]')).toThrow('type 无效')
  })

  it('parseCsvQuestions：标准表头解析（options 用 | 分隔，answer 支持字母/数字）', () => {
    const csv = [
      'type,question,options,answer,tag,explanation',
      'single,1+1=?,"1|2|3",B,基础,加法',
      'judge,地球是圆的,"正确|错误",0,常识,',
      'short,简述微积分,,, ,核心概念',
    ].join('\n')
    const out = parseCsvQuestions(csv)
    expect(out).toHaveLength(3)
    expect(out[0].type).toBe('single')
    expect(out[0].options).toEqual(['1', '2', '3'])
    expect(out[0].answer).toBe(1)
    expect(out[0].tag).toBe('基础')
    expect(out[1].type).toBe('judge')
    expect(out[1].answer).toBe(0)
    expect(out[2].type).toBe('short')
    expect(out[2].options).toBeUndefined()
  })

  it('parseCsvQuestions：错误行给出行列提示', () => {
    expect(() => parseCsvQuestions('type,question,options,answer\nsingle,题目,只一个选项,0')).toThrow('至少 2 个选项')
    expect(() => parseCsvQuestions('type,question,options,answer\nsingle,题目,"a|b",9')).toThrow('超出选项范围')
  })

  it('dedupeQuestions：与现有题库按签名去重并计数', () => {
    const existing = [{ type: 'single', question: '已有题', options: ['a', 'b'], answer: 0 }]
    const incoming = [
      { type: 'single', question: '已有题', options: ['a', 'b'], answer: 0 },
      { type: 'single', question: '新题', options: ['a', 'b'], answer: 1 },
      { type: 'single', question: '已有题', options: ['a', 'b'], answer: 0 },
    ]
    const r = dedupeQuestions(existing, incoming)
    expect(r.skipped).toBe(2)
    expect(r.added).toHaveLength(1)
    expect(r.added[0].question).toBe('新题')
    const r2 = dedupeQuestions([...existing, ...r.added], incoming)
    expect(r2.skipped).toBe(3)
    expect(r2.added).toHaveLength(0)
  })

  it('questionSignature 区分答案/选项差异、忽略题干空白差异', () => {
    const sig = { type: 'single', question: 'Q', answer: 0, options: ['a', 'b'] }
    expect(questionSignature(sig)).not.toBe(questionSignature({ ...sig, answer: 1 }))
    expect(questionSignature(sig)).toBe(questionSignature({ ...sig, question: ' Q ' }))
  })

  it('exportQuestionsJson：只导出可再导入字段，可 round-trip', () => {
    const qs = [{ id: 1, type: 'term', question: '什么是极限', tag: '极限', explanation: '解析', _local: true }]
    const json = exportQuestionsJson(qs, { chapterName: '第一章' })
    const parsed = JSON.parse(json)
    expect(parsed.chapterName).toBe('第一章')
    expect(parsed.questions[0]).toEqual({ type: 'term', question: '什么是极限', tag: '极限', explanation: '解析' })
    const re = parseJsonQuestions(json)
    expect(re[0].question).toBe('什么是极限')
  })

  it('normalizeQuestionType：中文/英文归一', () => {
    expect(normalizeQuestionType('单选')).toBe('single')
    expect(normalizeQuestionType('SINGLE')).toBe('single')
    expect(normalizeQuestionType('简答题')).toBe('short')
    expect(normalizeQuestionType('nope')).toBeNull()
  })
})