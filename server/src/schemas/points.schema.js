'use strict';

const { z } = require('zod');
const { userIdParamsSchema } = require('./users.schema');

// POST /api/v1/points/claims — 成就奖励领取
const claimSchema = z.object({
  type: z.enum(['achievement'], { errorMap: () => ({ message: 'type 仅支持 achievement' }) }),
  refId: z.string().trim().min(1, '缺少 refId').max(64, 'refId 过长'),
});

// POST /api/v1/users/:id/points/adjust — 管理员积分调整
const adjustBodySchema = z.object({
  delta: z.number().int('delta 必须为整数').refine((v) => v !== 0, { message: 'delta 不能为 0' }),
  note: z.string().trim().min(1, '请填写调整原因').max(500, 'note 最多 500 字'),
});

// GET /points/ledger 分页查询
const ledgerQuerySchema = z.object({
  page: z.coerce.number().int().positive({ message: 'page 必须为正整数' }).optional(),
  limit: z.coerce.number().int().min(1).max(100, 'limit 最大 100').optional(),
  reason: z.string().trim().min(1).max(32).optional(),
});

module.exports = { claimSchema, adjustBodySchema, ledgerQuerySchema, userIdParamsSchema };
