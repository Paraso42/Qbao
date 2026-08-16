'use strict';

const { requireAuth } = require('../middleware');
const { asyncHandler, ApiError } = require('../lib/errorHandler');
const { validate } = require('../lib/validate');
const { z } = require('zod');
const { aiGenerateBodySchema } = require('../schemas/ai.schema');
const { parseAiHeaders } = require('../lib/aiRequest');
const {
  createAiTask,
  listAiTasks,
  getAiTask,
  cancelAiTask,
} = require('../services/aiTaskService');

const idParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

module.exports = function (app) {
  // 创建后台 AI 出题任务（v1：非流式）
  app.post('/api/v1/ai/tasks', validate({ body: aiGenerateBodySchema }), requireAuth, asyncHandler(async (req, res) => {
    const parsed = parseAiHeaders(req);
    const task = await createAiTask(req.userId, {
      providerName: parsed.providerName,
      model: parsed.model,
      apiKey: parsed.apiKey,
      body: req.body,
    });
    res.status(202).json({ task });
  }));

  app.get('/api/v1/ai/tasks', requireAuth, asyncHandler(async (req, res) => {
    const limit = Number(req.query.limit) || 20;
    const tasks = await listAiTasks(req.userId, limit);
    res.json({ tasks });
  }));

  app.get('/api/v1/ai/tasks/:id', validate({ params: idParamsSchema }), requireAuth, asyncHandler(async (req, res) => {
    const task = await getAiTask(req.userId, req.params.id);
    if (!task) throw new ApiError(404, '任务不存在');
    res.json({ task });
  }));

  app.delete('/api/v1/ai/tasks/:id', validate({ params: idParamsSchema }), requireAuth, asyncHandler(async (req, res) => {
    const task = await cancelAiTask(req.userId, req.params.id);
    if (!task) throw new ApiError(404, '任务不存在或已开始执行');
    res.json({ task });
  }));
};
