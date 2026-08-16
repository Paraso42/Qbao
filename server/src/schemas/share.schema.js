'use strict';

const { z } = require('zod');

const createShareSchema = z.object({
  name: z.string().trim().min(1, 'name 必填').max(256, 'name 过长'),
  questions: z.array(z.unknown()).min(1, 'questions 不能为空').max(1000, 'questions 最多 1000 道'),
  password: z.string().min(1).max(128).optional(),
  expiresDays: z.number().int().min(1).max(365).optional(),
});

const shareCodeParamsSchema = z.object({
  code: z.string().trim().min(1).max(16),
});

const sharePasswordQuerySchema = z.object({
  password: z.string().max(128).optional(),
});

module.exports = { createShareSchema, shareCodeParamsSchema, sharePasswordQuerySchema };
