'use strict';

const { z } = require('zod');

const issueIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const createIssueSchema = z.object({
  title: z.string().trim().min(1, '标题不能为空').max(500, '标题不能超过500字'),
  content: z.string().trim().min(1, '内容不能为空').max(20000, '内容过长'),
});

const updateIssueTitleSchema = z.object({
  title: z.string().trim().min(1, '标题不能为空').max(500, '标题不能超过500字'),
});

const issueMessageSchema = z.object({
  content: z.string().max(20000).optional(),
  images: z.array(z.string().max(1024)).max(20).optional(),
});

const issueStatusSchema = z.object({
  status: z.enum(['unread', 'read', 'resolved', 'closed']),
  reason: z.string().trim().max(500).optional(),
});

module.exports = {
  issueIdParamsSchema,
  createIssueSchema,
  updateIssueTitleSchema,
  issueMessageSchema,
  issueStatusSchema,
};
