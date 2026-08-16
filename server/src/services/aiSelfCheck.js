'use strict';

// AI 自动判定（v3.27）
// 由用户自行开启：生成完成后，把题目与资料原文回传给同一模型进行二次审核。
// 消耗的是用户自己的 API 额度；服务端不设置频次限制，只限制单次审核输入长度。

const { repairJson, normalizeQuestions } = require('./aiQuestionParser');
const { validateQuestionSet } = require('./aiQuestionValidator');

const MAX_SOURCE_CHARS = 40000;
const MAX_QUESTIONS_CHARS = 60000;

function buildSelfCheckMessages(sourceText, questions) {
  const source = String(sourceText || '').slice(0, MAX_SOURCE_CHARS);
  const payload = JSON.stringify(questions || []).slice(0, MAX_QUESTIONS_CHARS);

  return [
    {
      role: 'system',
      content: [
        '你是一名严格的出题质量审核员。',
        '请审核用户提供的题目 JSON 数组，并返回修复后的 JSON 数组。',
        '审核规则：',
        '1. 事实必须与资料原文一致，存在事实错误且无法修复的题目删除；',
        '2. 单选题答案必须是 options 的有效下标，判断题答案必须是 0 或 1；',
        '3. 题型只能是 single/judge/term/short，字段结构保持不变；',
        '4. tag 必须简短且属于知识点标签，strategy 只能是 error/review/new；',
        '5. 保留 question/options/answer/tag/strategy/explanation 字段；',
        '6. 只输出纯 JSON 数组，不要输出解释、代码块或多余文字。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        '【资料原文】',
        source || '(未提供资料原文)',
        '',
        '【待审核题目】',
        payload,
      ].join('\n'),
    },
  ];
}

async function runAiSelfCheck({ provider, apiKey, model, modelConfig, sourceText, questions }) {
  const messages = buildSelfCheckMessages(sourceText, questions);

  const payloadLength = JSON.stringify(questions || []).length;
  const modelMaxOutput = Number(modelConfig && modelConfig.maxOutput) || 4096;
  const maxTokens = Math.max(1024, Math.min(modelMaxOutput, Math.ceil(payloadLength / 2) + 2048));

  const completion = await provider.chatCompletions(apiKey, model, messages, {
    temperature: 0,
    max_tokens: maxTokens,
  });

  const content = completion && completion.choices && completion.choices[0]
    ? completion.choices[0].message && completion.choices[0].message.content
    : '';

  if (!content || typeof content !== 'string' || !content.trim()) {
    throw new Error('AI 自动判定未返回内容');
  }

  const cleaned = repairJson(content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''));
  const parsed = JSON.parse(cleaned);
  const normalized = normalizeQuestions(parsed);
  const validation = validateQuestionSet(normalized);

  return {
    questions: validation.questions,
    warnings: validation.warnings,
    rawCount: normalized.length,
  };
}

module.exports = {
  MAX_SOURCE_CHARS,
  MAX_QUESTIONS_CHARS,
  buildSelfCheckMessages,
  runAiSelfCheck,
};
