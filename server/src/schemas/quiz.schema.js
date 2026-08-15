'use strict';

const { z } = require('zod');

const sessionStatus = z.enum(['in_progress', 'completed'], {
  errorMap: () => ({ message: 'status 只能是 in_progress 或 completed' })
});

// POST /api/v1/quiz/session — 创建/更新答题会话
const postSessionSchema = z.object({
  chapterId: z.string({
    required_error: '缺少 chapterId',
    invalid_type_error: 'chapterId 必须是字符串'
  }).trim().min(1, '缺少 chapterId').max(64, 'chapterId 过长'),
  subjectId: z.string().max(128, 'subjectId 过长').nullable().optional(),
  setId: z.string().max(128, 'setId 过长').optional(),
  sessionName: z.string().max(256, 'sessionName 过长').nullable().optional(),
  questions: z.array(z.unknown()).nullable().optional(),
  userAnswers: z.array(z.unknown()).nullable().optional(),
  stats: z.record(z.unknown()).nullable().optional(),
  status: sessionStatus.optional(),
});

// GET /api/v1/quiz/sessions?status=...
const listSessionsQuerySchema = z.object({
  status: sessionStatus.optional(),
});

// GET/DELETE /api/v1/quiz/session/:id
const idParamsSchema = z.object({
  id: z.coerce.number({ invalid_type_error: 'id 必须是数字' })
    .int('id 必须是整数')
    .positive('id 必须为正数'),
});

module.exports = { postSessionSchema, listSessionsQuerySchema, idParamsSchema };
