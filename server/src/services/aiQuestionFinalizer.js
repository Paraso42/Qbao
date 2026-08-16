'use strict';

// 生成结果统一收口（v3.27）
// 1. normalizeQuestions 归一化
// 2. validateQuestionSet 硬校验
// 3. 可选：用户开启 selfCheck 时，调用 AI 自动判定二次审核
// 任何一步失败都不影响主流程，按降级策略返回原始可用题目。

const { normalizeQuestions } = require('./aiQuestionParser');
const { validateQuestionSet } = require('./aiQuestionValidator');
const { runAiSelfCheck } = require('./aiSelfCheck');

async function finalizeAiQuestions({
  selfCheck,
  provider,
  apiKey,
  model,
  modelConfig,
  sourceText,
  rawQuestions,
}) {
  const baseValidation = validateQuestionSet(normalizeQuestions(rawQuestions));
  const baseWarnings = baseValidation.warnings.slice();
  let questions = baseValidation.questions;
  const selfCheckResult = { performed: false };

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

  return {
    questions,
    warnings: baseWarnings,
    baseValidation,
    selfCheck: selfCheckResult,
  };
}

module.exports = { finalizeAiQuestions };
