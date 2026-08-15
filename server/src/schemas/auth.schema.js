'use strict';

const { z } = require('zod');

// POST /api/v1/auth/register
const registerSchema = z.object({
  username: z.string({
    required_error: '用户名必填',
    invalid_type_error: '用户名必须是字符串'
  }).trim().min(3, '用户名至少 3 个字符').max(32, '用户名最多 32 个字符'),
  password: z.string({
    required_error: '密码必填',
    invalid_type_error: '密码必须是字符串'
  }).min(6, '密码至少 6 位').max(128, '密码最多 128 位'),
  displayName: z.string().trim().max(128, '昵称最多 128 个字符').optional(),
});

// POST /api/v1/auth/login
const loginSchema = z.object({
  username: z.string({
    required_error: '用户名必填',
    invalid_type_error: '用户名必须是字符串'
  }).trim().min(1, '用户名必填').max(64, '用户名最多 64 个字符'),
  password: z.string({
    required_error: '密码必填',
    invalid_type_error: '密码必须是字符串'
  }).min(1, '密码必填').max(256, '密码最多 256 位'),
});

module.exports = { registerSchema, loginSchema };
