// ============================================================
// strategy.js — 出题策略与标签管理（自 legacy strategy.js 抽取，纯逻辑）
// UI 层（滑杆/数量选择器/标签拖拽）以 Vue 组件绑定到 strategy 对象。
// ============================================================
import { getChStrategy } from './persistence'

export const TAG_CATS = ['error', 'review', 'new']

export function tagArr(s, cat) {
  return cat === 'new' ? (s.newTopicTags || []) : (s[cat + 'Tags'] || [])
}

export function addTagToCategory(state, chId, cat, name) {
  const s = getChStrategy(state, chId)
  if (!s) return
  const tag = String(name || '').trim()
  if (!tag) return
  const allTags = (s.errorTags || []).concat(s.reviewTags || [], s.newTopicTags || [])
  if (allTags.indexOf(tag) >= 0) return
  const arr = tagArr(s, cat)
  arr.push(tag)
  if (cat === 'new') s.newTopicTags = arr
  else s[cat + 'Tags'] = arr
  if (!s.tagMeta[tag]) s.tagMeta[tag] = { totalQ: 0, correct: 0 }
}

export function removeTagFromCategory(state, chId, cat, name) {
  const s = getChStrategy(state, chId)
  if (!s) return
  const arr = tagArr(s, cat)
  const idx = arr.indexOf(name)
  if (idx >= 0) arr.splice(idx, 1)
}

export function moveTagBetweenColumns(state, chId, tagName, fromCat, toCat) {
  const s = getChStrategy(state, chId)
  if (!s) return
  const fromArr = tagArr(s, fromCat)
  const toArr = tagArr(s, toCat)
  const idx = fromArr.indexOf(tagName)
  if (idx >= 0) fromArr.splice(idx, 1)
  if (toArr.indexOf(tagName) < 0) toArr.push(tagName)
}

export function mergeTagInCategory(state, chId, draggedTag, targetTag, cat) {
  const s = getChStrategy(state, chId)
  if (!s) return
  const ch = state.chapters[chId]
  const arr = tagArr(s, cat)
  const idx = arr.indexOf(draggedTag)
  if (idx >= 0) arr.splice(idx, 1)
  if (s.tagMeta[draggedTag] && s.tagMeta[targetTag]) {
    s.tagMeta[targetTag].totalQ += s.tagMeta[draggedTag].totalQ
    s.tagMeta[targetTag].correct += s.tagMeta[draggedTag].correct
  }
  delete s.tagMeta[draggedTag]
  ;(ch.quizSets || []).forEach(function (set) {
    set.questions.forEach(function (q) { if (q.tag === draggedTag) q.tag = targetTag })
  })
}

export function renameTag(state, chId, oldName, newName) {
  const clean = String(newName || '').trim()
  if (!clean || clean === oldName) return false
  const s = getChStrategy(state, chId)
  if (!s) return false
  const ch = state.chapters[chId]
  for (const cat of TAG_CATS) {
    const arr = tagArr(s, cat)
    const idx = arr.indexOf(oldName)
    if (idx >= 0) arr[idx] = clean
  }
  if (s.tagMeta[oldName]) { s.tagMeta[clean] = s.tagMeta[oldName]; delete s.tagMeta[oldName] }
  ;(ch.quizSets || []).forEach(function (set) {
    set.questions.forEach(function (q) { if (q.tag === oldName) q.tag = clean })
  })
  return true
}

// 章节策略占比直接输入：向右增减（语义同 legacy onChapterStrategyPctInput）
export function adjustStrategyPct(s, idx, newVal) {
  const pcts = [s.errPct || 0, s.reviewPct || 0, s.newPct || 0]
  newVal = Math.max(0, Math.min(100, newVal))
  const delta = newVal - pcts[idx]
  if (delta === 0) return pcts

  if (idx === 2) {
    pcts[1] -= delta
    pcts[2] += delta
  } else {
    pcts[idx + 1] -= delta
    pcts[idx] += delta
  }
  for (let i = 0; i < 3; i++) {
    if (pcts[i] < 0) {
      if (i < 2) { pcts[i + 1] += pcts[i]; pcts[i] = 0 }
      else { pcts[i - 1] += pcts[i]; pcts[i] = 0 }
    }
    if (pcts[i] > 100) pcts[i] = 100
  }
  const sum = pcts[0] + pcts[1] + pcts[2]
  if (sum !== 100) {
    pcts[1] = Math.max(0, 100 - pcts[0] - pcts[2])
    if (pcts[0] + pcts[1] + pcts[2] !== 100) {
      pcts[0] = Math.round(pcts[0] / sum * 100)
      pcts[1] = Math.round(pcts[1] / sum * 100)
      pcts[2] = 100 - pcts[0] - pcts[1]
    }
  }
  s.errPct = pcts[0]; s.reviewPct = pcts[1]; s.newPct = pcts[2]
  return pcts
}

// 双滑杆联动（err 滑块 + 累计滑块）语义同 legacy onChapterDualSlider
export function applyDualSlider(s, v1, v2) {
  if (v1 > v2) v2 = v1
  const rPct = v2 - v1
  const nPct = 100 - v2
  s.errPct = v1; s.reviewPct = rPct; s.newPct = nPct
  return { err: v1, review: rPct, newP: nPct }
}

// ===== 出题策略配额换算（生成提示词 / 策略符合度核算共用） =====
// err/review 按百分比取整、new 取余——顺序 clamp 防取整溢出为负数
// （如 5 题、错题50%+复习50% 时 round(2.5)+round(2.5)=6 > 5，旧逻辑会得到 -1 道）。
// 错题/复习标签为空时无从出"对应标签变式题"，该类配额并入新考点（提示词文案同步说明）。
export function computeStrategyTargets(totalQ, errPct, reviewPct, errorTags, reviewTags) {
  const errTarget = Math.max(0, Math.min(totalQ, Math.round(totalQ * (errPct || 0) / 100)))
  const reviewTarget = Math.max(0, Math.min(totalQ - errTarget, Math.round(totalQ * (reviewPct || 0) / 100)))
  let newTarget = totalQ - errTarget - reviewTarget
  const errMerged = errTarget > 0 && !(Array.isArray(errorTags) && errorTags.length > 0)
  const revMerged = reviewTarget > 0 && !(Array.isArray(reviewTags) && reviewTags.length > 0)
  let errOut = errTarget
  let reviewOut = reviewTarget
  if (errMerged) { newTarget += errOut; errOut = 0 }
  if (revMerged) { newTarget += reviewOut; reviewOut = 0 }
  return { error: errOut, review: reviewOut, new: newTarget, errMerged, revMerged }
}

// ===== 出题提示词（语义同 legacy generatePromptText） =====
export function generatePromptText(state, chId) {
  const s = getChStrategy(state, chId)
  if (!s) return ''
  const single = s.typeCounts.single || 0
  const judge = s.typeCounts.judge || 0
  const term = s.typeCounts.term || 0
  const short = s.typeCounts.short || 0
  const errPct = s.errPct || 0
  const reviewPct = s.reviewPct || 0

  const parts = []
  if (single > 0) parts.push(single + ' 道单选题')
  if (judge > 0) parts.push(judge + ' 道判断题')
  if (term > 0) parts.push(term + ' 道名词解释题')
  if (short > 0) parts.push(short + ' 道简答题')
  const qStr = parts.join('，') || '请自行决定题型与数量'
  const totalQ = single + judge + term + short
  const allocation = computeStrategyTargets(totalQ, errPct, reviewPct, s.errorTags, s.reviewTags)
  const errTarget = allocation.error
  const reviewTarget = allocation.review
  const newTarget = allocation.new

  const errorTags = s.errorTags || []
  const reviewTags = s.reviewTags || []
  const newTopicTags = s.newTopicTags || []
  const meta = s.tagMeta || {}

  function tagWithRate(t) {
    const m = meta[t] || { totalQ: 0, correct: 0 }
    const rate = m.totalQ > 0 ? Math.round(m.correct / m.totalQ * 100) : 0
    return t + '(共' + m.totalQ + '题 正确率' + rate + '%)'
  }
  const errStr = errorTags.length > 0 ? errorTags.map(tagWithRate).join('、') : '暂无'
  const revStr = reviewTags.length > 0 ? reviewTags.map(tagWithRate).join('、') : '暂无'
  const newStr = newTopicTags.length > 0 ? newTopicTags.map(tagWithRate).join('、') : '暂无'

  let base = '重要：只输出JSON数组，不要包含任何其他文字、代码块标记或解释。\n'
  base += '请根据提供的学习资料生成题目。\n\n'
  base += '【当前标签分类】\n'
  base += '- 错题标签：' + errStr + '\n'
  base += '- 复习标签：' + revStr + '\n'
  base += '- 新知识点标签：' + newStr + '\n'
  base += '注意：复习标签和错题标签都可能包含正确率不为 100% 的标签。正确率仅作为出题侧重参考，不是分类依据。\n\n'
  base += '【出题要求】\n'
  base += '1. 题型与数量：' + qStr + '。\n'
  base += '2. 内容来源：必须严格基于提供的资料，不得编造资料中不存在的事实。\n'
  base += '3. 避免重复：同一知识点不得输出与资料示例或此前已出题目雷同的题，请变换问法、场景或数值（变式题）。\n'
  base += '4. 格式要求：只输出纯文本的 JSON 数组。含有数学符号、上下标、分式、根号、积分、求和等内容的题目，必须使用 $...$ 包裹行内公式（如 $E=mc^2$、$x_1$），使用 $$...$$ 包裹独立公式块（如 $$\\sum_{i=1}^{n} x_i$$）。\n'
  base += '5. JSON 字段结构：所有题目必须包含 id, type("single"/"judge"/"term"/"short"), tag(知识点标签), question, explanation, strategy("error"/"review"/"new")。\n'
  base += '   单选增加 options(数组), answer(索引 0-3)；判断增加 options(["正确","错误"]), answer(0或1)；名词解释和简答不需要 options 和 answer。\n'
  base += '6. 出题策略分配（数量已按当前标签实际情况换算，请严格遵循）：\n'
  if (allocation.errMerged) {
    base += '   - 当前没有错题标签 → 错题回顾的配额已并入下方"新考点探索"，无需再出 strategy="error" 的题。\n'
  }
  if (allocation.revMerged) {
    base += '   - 当前没有复习标签 → 滚动复习的配额已并入下方"新考点探索"，无需再出 strategy="review" 的题。\n'
  }
  if (errTarget > 0) {
    base += '   - 错题回顾 (error)：' + errTarget + ' 道 — 从错题标签范围出变式题，tag 使用对应错题标签\n'
  }
  if (reviewTarget > 0) {
    base += '   - 滚动复习 (review)：' + reviewTarget + ' 道 — 从复习标签范围出巩固题，tag 使用对应复习标签\n'
  }
  if (newTarget > 0) {
    base += '   - 新考点探索 (new)：' + newTarget + ' 道 — 从资料中挖掘尚未被以上标签覆盖的全新知识点\n'
  }
  base += '   每道题的 strategy 字段必须恰好是 "error"、"review"、"new" 之一。\n'
  if (newTarget > 0) {
    base += '   【重要】strategy="new" 的题目：其 tag 必须是与错题标签、复习标签不同的全新知识点标签（从资料中挖掘未覆盖的考点）。如果新知识点标签列表非空则优先使用，否则自行从资料中提取新知识点作为 tag。\n'
  }
  base += '7. strategy="error"或"review"的题目，tag 应使用对应的已有标签；只有 strategy="new"的题目才创建新标签。\n'
  return base
}
