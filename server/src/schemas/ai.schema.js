'use strict';

const { z } = require('zod');

// 用户自持 AI Key，由前端放在请求头中；服务端只校验不落库。
const aiHeadersSchema = z.object({
  'x-ai-api-key': z.string({
    required_error: '缺少 AI API Key',
    invalid_type_error: 'x-ai-api-key 必须是字符串',
  }).trim().min(10, 'AI API Key 过短').max(512, 'AI API Key 过长').optional(),
  'x-ai-model': z.string({ invalid_type_error: 'x-ai-model 必须是字符串' })
    .trim().min(1, '缺少模型').max(128, '模型名过长')
    .optional(),
  'x-ai-provider': z.string({ invalid_type_error: 'x-ai-provider 必须是字符串' })
    .trim().min(1, '缺少供应商').max(64, '供应商名过长')
    .optional(),
  'x-ai-stream': z.enum(['true', 'false']).optional(),
});

const typeCountsSchema = z.object({
  single: z.number({ invalid_type_error: 'single 必须是数字' }).int().min(0).max(50).optional(),
  judge: z.number({ invalid_type_error: 'judge 必须是数字' }).int().min(0).max(50).optional(),
  term: z.number({ invalid_type_error: 'term 必须是数字' }).int().min(0).max(50).optional(),
  short: z.number({ invalid_type_error: 'short 必须是数字' }).int().min(0).max(50).optional(),
}).refine((value) => {
  const total = ['single', 'judge', 'term', 'short'].reduce((sum, key) => sum + (value[key] || 0), 0);
  return total <= 200;
}, { message: '单次生成题目总数不能超过 200 道' });

const chapterHistorySchema = z.object({
  totalQuestions: z.number().int().min(0).optional(),
  totalAnswered: z.number().int().min(0).optional(),
  totalWrong: z.number().int().min(0).optional(),
  tagStats: z.record(z.object({
    total: z.number().int().min(0).optional(),
    correct: z.number().int().min(0).optional(),
    wrong: z.number().int().min(0).optional(),
  })).optional(),
  topWrongTags: z.array(z.string().max(128)).max(20).optional(),
}).optional();

const aiGenerateBodySchema = z.object({
  textContent: z.string({ invalid_type_error: 'textContent 必须是字符串' })
    .max(2_000_000, 'textContent 过长')
    .optional()
    .default(''),
  imageUrls: z.array(z.string().url()).max(20).optional(),
  typeCounts: typeCountsSchema.optional(),
  prompt: z.string({ invalid_type_error: 'prompt 必须是字符串' })
    .max(20000, 'prompt 过长')
    .optional(),
  chapterHistory: chapterHistorySchema,
  chapterId: z.string().trim().max(64).nullable().optional(),
    selfCheck: z.boolean({ invalid_type_error: 'selfCheck 必须是布尔值' }).optional().default(false),
});

const aiTestBodySchema = z.object({
  message: z.string().max(2000).optional(),
});

module.exports = {
  aiHeadersSchema,
  aiGenerateBodySchema,
  aiTestBodySchema,
};
