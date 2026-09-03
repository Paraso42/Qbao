// ============================================================
// importExport.js — 题库导入导出的纯逻辑（v3.33 P3.2）
// JSON 粘贴/文件、CSV 批量导入、题目级幂等去重、JSON 导出。
// 纯函数设计：可单测、可在 ImportDialog / SubjectDashView 复用。
// ============================================================

export const QUESTION_TYPES = ['single', 'judge', 'term', 'short']

export function normalizeQuestionType(t) {
  const m = String(t || '').trim().toLowerCase()
  if (m === '单选' || m === 'single') return 'single'
  if (m === '判断' || m === 'judge') return 'judge'
  if (m === '名词解释' || m === 'term') return 'term'
  if (m === '简答' || m === 'short' || m === '简答题') return 'short'
  return null
}

// —— JSON 导入解析（语义兼容原 ImportDialog.parseQuestions） ——
export function parseJsonQuestions(raw) {
  const text = String(raw || '').trim()
  if (!text) return []
  const clean = String(text)
    .replace(/^```jsons*/i, '')
    .replace(/^```s*/i, '')
    .replace(/```*\s*$/, '')
    .trim()
  let arr = JSON.parse(clean)
  // 兼容 { chapterName, questions: [...] } 导出包装格式（导出 → 再导入 round-trip）
  if (arr && typeof arr === 'object' && !Array.isArray(arr) && Array.isArray(arr.questions)) {
    arr = arr.questions
  }
  if (!Array.isArray(arr)) throw new Error('JSON 必须是数组（或含 questions 数组的对象）')
  const out = []
  arr.forEach((item, i) => {
    const t = normalizeQuestionType(item && item.type)
    if (!t) throw new Error('第' + (i + 1) + '题 type 无效（应为 single/judge/term/short）')
    if (item.question === undefined || item.question === null || String(item.question) === '') {
      throw new Error('第' + (i + 1) + '题缺 question')
    }
    if ((t === 'single' || t === 'judge') && (!Array.isArray(item.options) || !item.options.length)) {
      throw new Error('第' + (i + 1) + '题缺 options')
    }
    out.push({ ...item, type: t })
  })
  // 空白/过短题干剔除（与 v3.32 ImportDialog 过滤语义一致）
  return out.filter((q) => q.question && String(q.question).trim().length > 2)
}

// —— CSV 导入解析（header: type,question,options,answer,tag,explanation；options 用 | 分隔） ——
function csvCell(v) {
  const s = String(v == null ? '' : v)
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1).replace(/""/g, '"')
  return s
}

export function parseCsvQuestions(csvText) {
  const lines = String(csvText || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.trim() !== '')
  if (lines.length === 0) return []
  const head = lines[0].split(',').map((c) => csvCell(c).trim().toLowerCase())
  const col = (name) => head.indexOf(name)
  let ci = col('type'), qi = col('question'), oi = col('options'), ai = col('answer'), ti = col('tag'), ei = col('explanation')
  const rows = ci < 0 && qi < 0 ? head : lines // 无表头时首行即数据（需列序约定：type,question,options,answer,tag,explanation）
  let dataLines
  if (ci < 0 && qi < 0) {
    ci = 0; qi = 1; oi = 2; ai = 3; ti = 4; ei = 5
    dataLines = lines
  } else {
    dataLines = lines.slice(1)
  }
  const out = []
  dataLines.forEach((line, i) => {
    const cells = line.split(',').map(csvCell)
    const type = normalizeQuestionType(cells[ci])
    if (!type) throw new Error('第 ' + (i + 1) + ' 行 type 无效')
    const question = (cells[qi] || '').trim()
    if (!question) throw new Error('第 ' + (i + 1) + ' 行缺 question')
    const q = { type, question }
    if (type === 'single' || type === 'judge') {
      const rawOpts = (cells[oi] || '').split('|').map((s) => s.trim()).filter(Boolean)
      if (rawOpts.length < 2) throw new Error('第 ' + (i + 1) + ' 行客观题需至少 2 个选项（用 | 分隔）')
      q.options = rawOpts
      const rawAnswer = String(cells[ai] == null ? '' : cells[ai]).trim()
      if (rawAnswer === '') throw new Error('第 ' + (i + 1) + ' 行客观题缺 answer')
      const letterIdx = 'ABCDEFGHIJ'.indexOf(rawAnswer.toUpperCase())
      q.answer = letterIdx >= 0 ? letterIdx : parseInt(rawAnswer, 10)
      if (isNaN(q.answer) || q.answer < 0 || q.answer >= q.options.length) {
        throw new Error('第 ' + (i + 1) + ' 行 answer 超出选项范围')
      }
    }
    if (cells[ti]) q.tag = cells[ti].trim()
    if (cells[ei]) q.explanation = cells[ei].trim()
    if (cells[5] !== undefined && !q.explanation && cells[5].trim()) { /* 兼容无 tag 列 */ }
    out.push(q)
  })
  return out.filter((q) => q.question.length > 2)
}

// —— 题目签名（幂等去重用） ——
export function questionSignature(q) {
  if (!q) return ''
  return JSON.stringify([q.type, String(q.question || '').trim(), q.answer, Array.isArray(q.options) ? q.options.join('|') : ''])
}

// 与现有题库去重：返回 { added, skipped, list }（保持传入顺序）
export function dedupeQuestions(existing, incoming) {
  const seen = new Set()
  ;(existing || []).forEach((q) => { const s = questionSignature(q); if (s) seen.add(s) })
  const added = []
  let skipped = 0
  ;(incoming || []).forEach((q) => {
    const s = questionSignature(q)
    if (s && seen.has(s)) { skipped++; return }
    if (s) seen.add(s)
    added.push(q)
  })
  return { added, skipped, list: added }
}

// —— JSON 导出（可再导入的题目子集） ——
export function exportQuestionsJson(questions, meta) {
  const clean = (questions || []).map((q) => {
    const out = {}
    ;['type', 'question', 'options', 'answer', 'tag', 'strategy', 'explanation'].forEach((k) => {
      if (q[k] !== undefined && q[k] !== null && q[k] !== '') out[k] = q[k]
    })
    return out
  })
  const payload = meta ? { ...meta, questions: clean } : clean
  return JSON.stringify(payload, null, 2)
}

// 触发浏览器下载（纯逻辑注入出口；测试环境可注入空实现）
export function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}