'use strict';

// AI 生成题目结构校验器（v3.27）
// normalizeQuestions 只做字段归一化；这里执行可机检的硬校验：
// 题型合法、客观题选项数量、answer 下标、题干长度、tag 必填。
// 不满足硬校验的题目会被移入 warnings，不进入题库。

const VALID_TYPES = ['single', 'judge', 'term', 'short'];

function validateQuestion(question, index) {
  const errors = [];
  if (!question || typeof question !== 'object') {
    return ['第 ' + (index + 1) + ' 题不是对象'];
  }
  if (!question.question || typeof question.question !== 'string' || question.question.trim().length < 3) {
    errors.push('题干缺失或过短');
  }
  if (!question.type || VALID_TYPES.indexOf(question.type) === -1) {
    errors.push('type 非法');
  }
  if (!question.tag || typeof question.tag !== 'string' || !question.tag.trim()) {
    errors.push('tag 缺失');
  }

  if (question.type === 'single') {
    if (!Array.isArray(question.options) || question.options.length < 2) {
      errors.push('单选题至少需要 2 个选项');
    } else if (!Number.isInteger(question.answer) || question.answer < 0 || question.answer >= question.options.length) {
      errors.push('单选题 answer 越界');
    }
  }

  if (question.type === 'judge') {
    if (!Array.isArray(question.options) || question.options.length !== 2) {
      errors.push('判断题必须恰好 2 个选项');
    } else if (question.answer !== 0 && question.answer !== 1) {
      errors.push('判断题 answer 必须是 0 或 1');
    }
  }

  return errors;
}

function validateQuestionSet(questions) {
  const valid = [];
  const warnings = [];

  (Array.isArray(questions) ? questions : []).forEach((question, index) => {
    const errors = validateQuestion(question, index);
    if (errors.length > 0) {
      warnings.push({
        index,
        question: question && question.question ? String(question.question).slice(0, 120) : '(无题干)',
        errors,
      });
    } else {
      valid.push(question);
    }
  });

  return {
    questions: valid,
    warnings,
    validCount: valid.length,
    invalidCount: warnings.length,
  };
}

module.exports = {
  VALID_TYPES,
  validateQuestion,
  validateQuestionSet,
};
