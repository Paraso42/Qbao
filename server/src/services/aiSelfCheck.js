'use strict';

// AI 自动判定（v3.27）
// 由用户自行开启：生成完成后，把题目与资料原文回传给同一模型进行二次审核。
// 消耗的是用户自己的 API 额度；服务端不设置频次限制，只限制单次审核输入长度。

const { repairJson, normalizeQuestions } = require('./aiQuestionParser');
const { validateQuestionSet } = require('./aiQuestionValidator');

const MAX_SOURCE_CHARS = 40000;
const MAX_QUESTIONS_CHARS = 60000;

// 提示词疏漏兜底：原第 1 条只写了「存在事实错误且无法修复的题目删除」，没有反向约束
// 「没有问题的题目必须原样保留」。实测（ECNU ecnu-plus，2026-09-16）模型会直接返回空数组
// [] —— completion_tokens=2、耗时 300ms，等于完全没有执行审核；此时 finalizeAiQuestions
// 判定「AI 自动判定后没有可用题目，保留原始结果」，用户开启自检花掉的这次调用完全白费。
// 处置：识别「未真正参与」的空结果（0 题 + 消耗 tokens 低于阈值），补一句显式指令重试一次。
const SELF_CHECK_RETRY_MAX = 1;
const SELF_CHECK_MIN_ENGAGED_TOKENS = 20;
const KEEP_ALL_RULE = '没有问题的题目必须原样保留，不得因为「无需修改」而省略、合并或删除；只有确实存在错误、且无法修复的题目才允许删除。';

function buildSelfCheckMessages(sourceText, questions, opts) {
  const strict = !!(opts && opts.strictKeepAll);
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
        strict ? '6. ' + KEEP_ALL_RULE : '6. 只输出纯 JSON 数组，不要输出解释、代码块或多余文字。',
      ].concat(strict ? ['7. 只输出纯 JSON 数组，不要输出解释、代码块或多余文字。'] : []).join('\n'),
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
  const payloadLength = JSON.stringify(questions || []).length;
  const modelMaxOutput = Number(modelConfig && modelConfig.maxOutput) || 4096;
  const maxTokens = Math.max(1024, Math.min(modelMaxOutput, Math.ceil(payloadLength / 2) + 2048));

  let lastEmptySignal = null;

  for (let attempt = 0; attempt <= SELF_CHECK_RETRY_MAX; attempt++) {
    const messages = buildSelfCheckMessages(sourceText, questions, { strictKeepAll: attempt > 0 });
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

    const fence = String.fromCharCode(96).repeat(3);
    const cleaned = repairJson(content.trim()
      .replace(new RegExp('^' + fence + '(?:json)?\\s*', 'i'), '')
      .replace(new RegExp('\\s*' + fence + '$'), ''));
    const parsed = JSON.parse(cleaned);
    const normalized = normalizeQuestions(parsed);
    const validation = validateQuestionSet(normalized);

    // 空数组 + 几乎没消耗 tokens = 模型没有真正执行审核（而非「审完把题全删了」），
    // 这类结果对用户毫无价值，补一条显式指令重试一次。
    const usedTokens = (completion && completion.usage && Number(completion.usage.completion_tokens)) || 0;
    const looksUnengaged = validation.questions.length === 0
      && (questions || []).length > 0
      && usedTokens < SELF_CHECK_MIN_ENGAGED_TOKENS;
    if (looksUnengaged && attempt < SELF_CHECK_RETRY_MAX) {
      lastEmptySignal = { rawCount: normalized.length, completionTokens: usedTokens };
      console.log('[self-check] 模型空转（0 题 / ' + usedTokens + ' tokens），补显式指令重试一次');
      continue;
    }

    return {
      questions: validation.questions,
      warnings: validation.warnings,
      rawCount: normalized.length,
      retried: attempt > 0,
      unengaged: looksUnengaged ? (lastEmptySignal || { completionTokens: usedTokens }) : null,
    };
  }

  // 理论不可达：循环内必然 return
  return { questions: [], warnings: [], rawCount: 0, retried: true, unengaged: lastEmptySignal };
}

module.exports = {
  MAX_SOURCE_CHARS,
  MAX_QUESTIONS_CHARS,
  buildSelfCheckMessages,
  runAiSelfCheck,
};
