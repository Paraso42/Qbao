'use strict';

const { z } = require('zod');

const noticeIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const createNoticeSchema = z.object({
  content: z.string().trim().min(1, '内容不能为空').max(500, '内容不能超过500字'),
  type: z.string().trim().max(32).optional(),
  link: z.string().trim().max(512).nullable().optional(),
  expire_at: z.string().max(64).nullable().optional(),
  duration: z.number().int().min(0).max(60000).optional(),
});

const updateNoticeSchema = createNoticeSchema.partial();

const sortNoticesSchema = z.object({
  items: z.array(z.object({
    id: z.coerce.number().int().positive(),
    sort_order: z.number().int(),
  })).max(500),
});

module.exports = {
  noticeIdParamsSchema,
  createNoticeSchema,
  updateNoticeSchema,
  sortNoticesSchema,
};
