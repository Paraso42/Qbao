'use strict';

// 生成结果统一收口（v3.27 → v3.28）
// 1. normalizeQuestions 归一化
// 2. validateQuestionSet 硬校验
// 3. 题型配额收口；若有题型缺口（shortfall>0）→ 补题（top-up）机制，
//    用纠正提示词再生成缺失题型，保证最终数量与用户设定一致（修复"要求3道只出2道"）。
// 4. 可选：用户开启 selfCheck 时，调用 AI 自动判定二次审核（在补题之后执行，覆盖全部题目）
// 5. 最终再次收口（自检可能改写题量；补题后确保不超配额）
// 任何一步失败都不影响主流程，按降级策略返回原始可用题目。

const { normalizeQuestions, applyTypeQuota } = require('./aiQuestionParser');
const { validateQuestionSet } = require('./aiQuestionValidator');
const { runAiSelfCheck } = require('./aiSelfCheck');
const { aiQuestionSchema } = require('../lib/aiQuestionSchema');

const TOPUP_MAX_ATTEMPTS = 2;

const TOPUP_SYSTEM_PROMPT = [
  '你是一个出题助手。请根据提供的资料生成考试题目。',
  '只输出纯JSON数组，不要包含代码块标记或解释。',
  '每道题包含：id、type(single/judge/term/short)、question、options(数组)、answer(数字下标)、tag、strategy(error/review/new)、explanation。',
  '单选题 4 个选项且 answer 为 0-3；判断题 options 为 ["正确","错误"] 且 answer 为 0 或 1；名词解释和简答题不需要 options/answer。',
  '不得输出与资料示例或此前已出题目雷同的题，同知识点请变换问法、场景或数值。',
  '输出顺序：单选题 → 判断题 → 名词解释 → 简答题。',
  '数学公式使用 $...$ 或 $...$ 包裹。',
].join('\n');

function hasShortfall(s) {
  return !!(s && (s.single > 0 || s.judge > 0 || s.term > 0 || s.short > 0));
}

function shortfallLabels(s) {
  const labels = [['single', '单选题'], ['judge', '判断题'], ['term', '名词解释'], ['short', '简答题']];
  return labels
    .filter(([t]) => (s && s[t] > 0))
    .map(([t, label]) => label + ' ' + s[t] + ' 道');
}

// 缺什么补什么：只要求缺失题型数量，并附已生成题目清单避免重复。
async function topUpShortfall({ provider, apiKey, model, modelConfig, sourceText, questions, typeCounts, shortfall, signal }) {
  const missing = shortfallLabels(shortfall);
  if (missing.length === 0) return { questions, shortfall, attempts: 0 };

  if (signal && signal.aborted) return { questions, shortfall, attempts: 0 };

  const totalMissing = (shortfall.single || 0) + (shortfall.judge || 0) + (shortfall.term || 0) + (shortfall.short || 0);
  const opts = {
    temperature: 0.7,
    max_tokens: Math.min(
      Number(modelConfig && modelConfig.maxOutput) || 4096,
      Math.max(1024, totalMissing * 300 + 2048)
    ),
  };
  if (signal) opts.signal = signal;
  if (provider.supportsJsonSchema && provider.supportsJsonSchema(model)) {
    opts.response_format = { type: 'json_schema', json_schema: { name: 'questions', schema: aiQuestionSchema } };
  } else if (provider.name === 'deepseek') {
    opts.response_format = { type: 'json_object' };
  }

  let current = questions.slice();
  let remain = { ...shortfall };
  let attempts = 0;
  for (; attempts < TOPUP_MAX_ATTEMPTS && hasShortfall(remain); attempts++) {
    if (signal && signal.aborted) break;
    const need = shortfallLabels(remain).join('、');
    const existing = current.map((q) => q && q.question).filter(Boolean);
    const userText = [
      '请根据以下资料出题：',
      '',
      sourceText || '（无资料，请生成通用练习题）',
      '',
      '本次只需要生成以下题型：' + need,
      '新题目不得与以下已生成题目重复：' + existing.slice(0, 40).join(' / ').slice(0, 1500),
      '只输出纯JSON数组，不要包含代码块标记或解释。',
    ].join('\n');

    const messages = [
      { role: 'system', content: TOPUP_SYSTEM_PROMPT },
      { role: 'user', content: userText },
    ];

    try {
      const completion = await provider.chatCompletions(apiKey, model, messages, opts);
      const output = completion && completion.choices && completion.choices[0]
        ? completion.choices[0].message.content : '';
      let cleaned = String(output || '').trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '');
      const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
      if (jsonMatch) cleaned = jsonMatch[0];
      let parsed = [];
      try {
        parsed = normalizeQuestions(JSON.parse(cleaned));
      } catch (e) {
        parsed = [];
      }
      const seen = new Set(current.map((q) => (q && q.question) || ''));
      parsed.forEach((q) => {
        if (q && q.question && !seen.has(q.question)) {
          current.push(q);
          seen.add(q.question);
        }
      });
      const quota = applyTypeQuota(current, typeCounts);
      current = quota.questions;
      remain = quota.shortfall;
      console.log(
        '[top-up] attempt=' + (attempts + 1) + ' parsed=' + parsed.length +
        ' total=' + current.length + ' remain=' + JSON.stringify(remain)
      );
    } catch (e) {
      if (signal && signal.aborted) break;
      console.warn('[top-up] attempt=' + (attempts + 1) + ' failed: ' + e.message);
    }
  }

  return { questions: current, shortfall: remain, attempts };
}

async function finalizeAiQuestions({
  selfCheck,
  provider,
  apiKey,
  model,
  modelConfig,
  sourceText,
  rawQuestions,
  typeCounts,
  signal, // 可选：外部 AbortSignal（取消任务/断连中止时用于中止补题请求）
}) {
  const baseValidation = validateQuestionSet(normalizeQuestions(rawQuestions));
  const baseWarnings = baseValidation.warnings.slice();
  let questions = baseValidation.questions;
  const selfCheckResult = { performed: false };
  const topUpInfo = { performed: false, attempts: 0, remainingShortfall: { single: 0, judge: 0, term: 0, short: 0 } };

  // 1) 按配额收口；存在缺口且可用补题能力 → 补题合并
  let quota = applyTypeQuota(questions, typeCounts);
  if (hasShortfall(quota.shortfall) && provider && apiKey) {
    const topUp = await topUpShortfall({
      provider,
      apiKey,
      model,
      modelConfig,
      sourceText,
      questions: quota.questions,
      typeCounts,
      shortfall: quota.shortfall,
      signal,
    });
    topUpInfo.performed = true;
    topUpInfo.attempts = topUp.attempts;
    topUpInfo.remainingShortfall = { ...topUp.shortfall };
    questions = topUp.questions;
  } else {
    questions = quota.questions;
  }

  // 2) 可选自检（补题之后执行，覆盖合并后的全部题目）
  if (selfCheck && questions.length > 0) {
    selfCheckResult.performed = true;
    try {
      const result = await runAiSelfCheck({
        provider,
        apiKey,
        model,
        modelConfig,
        sourceText,
        questions,
      });

      if (result.questions.length > 0) {
        questions = result.questions;
        selfCheckResult.status = 'ok';
        selfCheckResult.before = baseValidation.validCount;
        selfCheckResult.after = result.questions.length;
        selfCheckResult.warnings = result.warnings;
        baseWarnings.push(...result.warnings);
      } else {
        selfCheckResult.status = 'empty';
        selfCheckResult.error = 'AI 自动判定后没有可用题目，保留原始结果';
      }
    } catch (e) {
      selfCheckResult.status = 'failed';
      selfCheckResult.error = e && e.message ? e.message : '未知错误';
    }
  }

  // 3) 最终收口（自检可能改写题量；补题后确保不超配额），并报告最终缺口
  const finalQuota = applyTypeQuota(questions, typeCounts);
  questions = finalQuota.questions;
  if (hasShortfall(finalQuota.shortfall)) {
    baseWarnings.push('题型配额未完全满足，尚缺：' + shortfallLabels(finalQuota.shortfall).join('、'));
  }

  return {
    questions,
    warnings: baseWarnings,
    baseValidation,
    selfCheck: selfCheckResult,
    topUp: topUpInfo,
    typeShortfall: finalQuota.shortfall,
  };
}

module.exports = { finalizeAiQuestions };