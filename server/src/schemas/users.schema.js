'use strict';

const { z } = require('zod');

const userIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const updateMeSchema = z.object({
  displayName: z.string().trim().max(128, '昵称最多 128 个字符').optional(),
  password: z.string().min(1).max(256).optional(),
  newPassword: z.string().min(6, '新密码至少 6 位').max(128, '新密码最多 128 位').optional(),
});

const avatarBodySchema = z.object({
  avatar: z.string().min(1, '缺少 avatar 字段').max(10_000_000, 'avatar 过大'),
});

const adminListUsersQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  role: z.enum(['admin', 'user']).optional(),
  banned: z.enum(['true', 'false']).optional(),
  search: z.string().trim().max(100).optional(),
});

const adminUpdateUserSchema = z.object({
  displayName: z.string().trim().max(128).optional(),
  role: z.enum(['admin', 'user']).optional(),
  password: z.string().min(6, '密码至少 6 位').max(128).optional(),
});

const banUserSchema = z.object({
  banned: z.boolean({ required_error: '缺少 banned 字段' }),
});

module.exports = {
  userIdParamsSchema,
  updateMeSchema,
  avatarBodySchema,
  adminListUsersQuerySchema,
  adminUpdateUserSchema,
  banUserSchema,
};
