'use strict';

const { z } = require('zod');

const createBackupSchema = z.object({
  label: z.string().trim().max(256, 'label 过长').optional(),
});

const backupIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

module.exports = { createBackupSchema, backupIdParamsSchema };
