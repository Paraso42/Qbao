'use strict';

const { z } = require('zod');

const listFilesQuerySchema = z.object({
  pool: z.enum(['true', 'false']).optional(),
  chapter_id: z.string().trim().max(64).optional(),
});

const idParamsSchema = z.object({
  id: z.coerce.number({ invalid_type_error: 'id 必须是数字' })
    .int('id 必须是整数')
    .positive('id 必须为正数'),
});

const assignFileBodySchema = z.object({
  chapterId: z.string({ required_error: '缺少 chapterId' })
    .trim().min(1, '缺少 chapterId')
    .max(64, 'chapterId 过长'),
});

module.exports = {
  listFilesQuerySchema,
  idParamsSchema,
  assignFileBodySchema,
};
