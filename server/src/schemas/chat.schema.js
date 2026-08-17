'use strict';

const { z } = require('zod');

const chatIdParamsSchema = z.object({
  roomId: z.coerce.number().int().positive(),
});

const chatMessageIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const chatFriendIdParamsSchema = z.object({
  friendId: z.coerce.number().int().positive(),
});

const chatRequestIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const chatUserSearchQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
});

const friendRequestBodySchema = z.object({
  friendId: z.number().int().positive(),
  message: z.string().max(200).optional(),
});

const createRoomSchema = z.object({
  type: z.enum(['direct', 'group']),
  friendId: z.number().int().positive().optional(),
  name: z.string().trim().max(128).optional(),
  memberIds: z.array(z.number().int().positive()).max(100).optional(),
});

const listMessagesQuerySchema = z.object({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const sendMessageSchema = z.object({
  content: z.string().max(20000).optional(),
  images: z.array(z.string().max(1024)).max(20).optional(),
  file_info: z.record(z.unknown()).nullable().optional(),
  msg_type: z.enum(['text', 'image', 'file', 'quiz_share', 'bank_share']).optional(),
  quiz_data: z.record(z.unknown()).nullable().optional(),
  reply_to: z.record(z.unknown()).nullable().optional(),
});

const addMembersSchema = z.object({
  userIds: z.array(z.number().int().positive()).min(1).max(100),
});

const updateQuizSchema = z.object({
  quiz_data: z.record(z.unknown(), { required_error: 'quiz_data is required' }),
});

module.exports = {
  chatIdParamsSchema,
  chatMessageIdParamsSchema,
  chatFriendIdParamsSchema,
  chatRequestIdParamsSchema,
  chatUserSearchQuerySchema,
  friendRequestBodySchema,
  createRoomSchema,
  listMessagesQuerySchema,
  sendMessageSchema,
  addMembersSchema,
  updateQuizSchema,
};
