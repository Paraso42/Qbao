'use strict';

const { z } = require('zod');

// PUT /api/v1/data — 全量写入，可选 rev 乐观锁
const putDataSchema = z.object({
  state_json: z.record(z.unknown(), {
    required_error: 'state_json 必填',
    invalid_type_error: 'state_json 必须是对象'
  }),
  rev: z.number({ invalid_type_error: 'rev 必须是数字' })
    .int('rev 必须是整数')
    .positive('rev 必须为正数')
    .optional(),
});

// PATCH /api/v1/data/section — 部分更新（rev CAS）
const patchSectionSchema = z.object({
  section: z.string({
    required_error: 'section 必填',
    invalid_type_error: 'section 必须是字符串'
  }).trim().min(1, 'section 必填').max(128, 'section 过长'),
  data: z.record(z.unknown(), {
    required_error: 'data 必填',
    invalid_type_error: 'data 必须是对象'
  }),
  rev: z.number({ invalid_type_error: 'rev 必须是数字' })
    .int('rev 必须是整数')
    .positive('rev 必须为正数')
    .optional(),
});

module.exports = { putDataSchema, patchSectionSchema };
