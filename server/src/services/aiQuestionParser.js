'use strict';

// AI 生成结果归一化与流式 JSON 提取（v3.27）
// 从 ai.routes.js 中迁出，便于独立测试与后续替换为更严格的解析器。

const VALID_TYPES = ['single', 'judge', 'term', 'short'];

function normalizeQuestions(raw) {
  if (!raw) return [];

  // 普通对象（非数组）包一层统一处理。
  let items = Array.isArray(raw) ? raw : [raw];

  // 展开 {multipleChoice:[...], trueFalse:[...], questions:[...]} 等包装结构。
  const flat = [];
  items.forEach((item) => {
    if (item && typeof item === 'object' && !item.question) {
      let found = false;
      const wrapperKeys = [
        'multipleChoice', 'multiple_choice', 'multiplechoice',
        'singleChoice', 'single_choice', 'trueFalse', 'true_false', 'truefalse',
        'questions', 'topics', 'items', 'results',
      ];
      wrapperKeys.forEach((key) => {
        if (Array.isArray(item[key]) && item[key].length > 0 && item[key][0].question) {
          flat.push(...item[key]);
          found = true;
        }
      });
      if (!found) flat.push(item);
    } else {
      flat.push(item);
    }
  });
  items = flat;

  const normalized = items.map((q) => {
    if (!q || typeof q !== 'object') return null;
    if (!q.question || typeof q.question !== 'string' || q.question.trim().length < 3) return null;

    // options 对象 {A:'...', B:'...'} → 数组。
    if (q.options && typeof q.options === 'object' && !Array.isArray(q.options)) {
      const keys = Object.keys(q.options).sort();
      q.options = keys.map((key) => q.options[key]);
    }
    if (!q.options || !Array.isArray(q.options)) q.options = [];
    q.options = q.options.map((opt) => (
      typeof opt === 'string' ? opt.replace(/^[A-D]:\s*/, '') : opt
    ));

    // answer 字母 → 数字下标；对/错/true/false → 判断题下标。
    if (typeof q.answer === 'string' && q.answer.length === 1) {
      const code = q.answer.toUpperCase().charCodeAt(0);
      if (code >= 65 && code <= 90) {
        q.answer = code - 65;
      } else if (q.answer === '对' || q.answer === '√' || q.answer.toLowerCase() === 'true') {
        q.answer = 0;
        q.type = q.type || 'judge';
      } else if (q.answer === '错' || q.answer === '×' || q.answer.toLowerCase() === 'false') {
        q.answer = 1;
        q.type = q.type || 'judge';
      }
    }
    if (typeof q.answer === 'boolean') {
      q.answer = q.answer ? 0 : 1;
      q.type = q.type || 'judge';
    }

    // type 变体归一。
    if (q.type) {
      const type = String(q.type).toLowerCase().replace(/[-_\s]/g, '');
      if (type === 'singlechoice' || type === 'multiplechoice' || type === 'choice' || type === 'multichoice') q.type = 'single';
      else if (type === 'truefalse' || type === 'bool' || type === 'boolean') q.type = 'judge';
      else if (type === 'term' || type === 'definition' || type === 'explain') q.type = 'term';
      else if (type === 'short' || type === 'shortanswer' || type === 'essay') q.type = 'short';
      if (['single', 'judge', 'term', 'short'].indexOf(q.type) === -1) {
        q.type = q.options && q.options.length >= 2 ? 'single' : 'short';
      }
    } else {
      q.type = q.options && q.options.length >= 2 ? 'single' : 'short';
    }

    if (!q.tag) q.tag = 'default';
    if (!q.strategy) q.strategy = 'new';
    if (!q.explanation) q.explanation = '';

    return q;
  }).filter(Boolean);

  if (items.length > 0 && normalized.length === 0) {
    console.log('[normalize] All ' + items.length + ' items filtered out — no valid question objects found');
  }

  return normalized;
}

function repairJson(text) {
  return String(text || '')
    .replace(/"(\w+)"\s+"/g, '"$1": "')
    .replace(/"(\w+)"\s+(-?\d+(?:\.\d+)?|true|false|null)/g, '"$1": $2');
}

// 从流式累积文本中提取已闭合的题目 JSON 对象。
function tryExtractCompletedObjects(text, knownCount) {
  const cleaned = String(text || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const result = [];
  let braceDepth = 0;
  let arrDepth = 0;
  let arrBaseBrace = 0;
  let inObj = false;
  let objStart = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];

    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') { inString = true; continue; }
    if (ch === '{') {
      if (!inObj && arrDepth > 0 && braceDepth === arrBaseBrace) {
        inObj = true;
        objStart = i;
      }
      braceDepth++;
    } else if (ch === '}') {
      braceDepth--;
      if (inObj && braceDepth === arrBaseBrace) {
        const candidate = repairJson(cleaned.substring(objStart, i + 1));
        try {
          const obj = JSON.parse(candidate);
          if (obj && obj.question && typeof obj.question === 'string') {
            const isDup = result.some((r) => r.question === obj.question);
            if (!isDup) result.push(obj);
          }
        } catch (_) { /* skip malformed object */ }
        inObj = false;
        objStart = -1;
      }
    } else if (ch === '[') {
      if (arrDepth === 0) arrBaseBrace = braceDepth;
      arrDepth++;
    } else if (ch === ']') {
      arrDepth--;
      if (arrDepth === 0) {
        inObj = false;
        objStart = -1;
      }
    }
  }

  return result.length > knownCount ? result.slice(knownCount) : null;
}

// 按题型配额收口：每道题型最多保留 requested count 道，超出的多余题删除。
// 若某题型实际产出不足配额，则给出缺少的数量，不强行补足。
// typeCounts 未提供（undefined/null）时保持原样放行，不做任何裁剪。
// 返回 { questions, shortfall: { single, judge, term, short } }。
function applyTypeQuota(questions, typeCounts) {
  const src = Array.isArray(questions) ? questions : [];
  // 未指定配额：不裁剪，原样返回。
  if (!typeCounts || typeof typeCounts !== 'object') {
    return { questions: src.slice(), shortfall: { single: 0, judge: 0, term: 0, short: 0 } };
  }
  const need = {
    single: Math.max(0, Math.floor(typeCounts.single) || 0),
    judge: Math.max(0, Math.floor(typeCounts.judge) || 0),
    term: Math.max(0, Math.floor(typeCounts.term) || 0),
    short: Math.max(0, Math.floor(typeCounts.short) || 0),
  };
  const taken = { single: 0, judge: 0, term: 0, short: 0 };
  const kept = [];
  src.forEach((q) => {
    if (!q || typeof q !== 'object') return;
    const t = VALID_TYPES.indexOf(q.type) >= 0 ? q.type : 'single';
    if (need[t] > 0 && taken[t] < need[t]) {
      kept.push(q);
      taken[t]++;
    }
  });
  const shortfall = { single: need.single - taken.single, judge: need.judge - taken.judge, term: need.term - taken.term, short: need.short - taken.short };
  return { questions: kept, shortfall };
}

module.exports = {
  normalizeQuestions,
  repairJson,
  tryExtractCompletedObjects,
  applyTypeQuota,
};
