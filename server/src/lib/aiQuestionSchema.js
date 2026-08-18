'use strict';

// 出题 JSON Schema（v3.28）
// 从 ai.routes.js 迁出，供主生成路径与补题（top-up）/纠正性重试共用。

const aiQuestionSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['single', 'judge', 'term', 'short'] },
      question: { type: 'string' },
      options: { type: 'array', items: { type: 'string' } },
      answer: { type: 'integer' },
      tag: { type: 'string' },
      strategy: { type: 'string', enum: ['error', 'review', 'new'] },
      explanation: { type: 'string' }
    },
    required: ['type', 'question', 'tag', 'strategy', 'explanation']
  }
};

module.exports = { aiQuestionSchema };