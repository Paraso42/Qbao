'use strict';

const { ApiError } = require('./ApiError');
const { aiHeadersSchema } = require('../schemas/ai.schema');
const {
  getProviderByModel,
  getProviderConfig,
  getModelConfig,
  resolveProvider,
} = require('../providers');

function parseAiHeaders(req) {
  const parsed = aiHeadersSchema.safeParse(req.headers || {});
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first.path.join('.');
    throw new ApiError(422, path ? first.message + '（' + path + '）' : first.message);
  }

  const headers = parsed.data;
  const apiKey = headers['x-ai-api-key'];
  if (!apiKey) {
    throw new ApiError(401, '缺少 AI API Key，请在设置中配置');
  }
  const model = headers['x-ai-model'] || '';
  const providerName = headers['x-ai-provider'] || getProviderByModel(model) || 'ecnu';
  const useStream = headers['x-ai-stream'] === 'true';

  return { apiKey, model, providerName, useStream };
}

// 校验 provider/model，并返回实现适配器与目录配置。
// 任何不匹配都返回 422，不再静默回退到 ECNU。
function resolveAiTarget(providerName, model) {
  const providerConfig = getProviderConfig(providerName);
  if (!providerConfig) {
    throw new ApiError(422, '未知 AI 供应商：' + providerName);
  }

  const effectiveModel = model || providerConfig.models[0]?.id;
  const modelConfig = effectiveModel ? getModelConfig(providerName, effectiveModel) : null;
  if (!effectiveModel || !modelConfig) {
    throw new ApiError(422, '模型与供应商不匹配：' + providerName + '/' + model);
  }

  const provider = resolveProvider(providerName);
  if (!provider) {
    throw new ApiError(422, 'AI 供应商适配器不可用：' + providerName);
  }

  return { provider, providerConfig, model: effectiveModel, modelConfig };
}

function normalizeTypeCounts(raw) {
  const input = raw || {};
  const counts = {
    single: clampCount(input.single, 10),
    judge: clampCount(input.judge, 5),
    term: clampCount(input.term, 2),
    short: clampCount(input.short, 1),
  };

  let total = counts.single + counts.judge + counts.term + counts.short;
  if (total === 0) counts.single = 1;
  total = counts.single + counts.judge + counts.term + counts.short;

  return { counts, total };
}

function clampCount(value, defaultValue) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return defaultValue;
  return Math.max(0, Math.min(50, Math.floor(value)));
}

// 由文本长度和题量估算所需输出 token，并受 provider/model 最大输出限制。
function calculateMaxTokens(textLength, totalQuestions, providerConfig, modelConfig) {
  const baseTokens = Math.max(4096, Math.ceil((textLength || 0) / 2) * 3);
  const perQuestionTokens = 300;
  const needed = baseTokens + totalQuestions * perQuestionTokens;

  const providerMax = Number(
    modelConfig?.maxOutput ||
    providerConfig?.defaults?.maxTokens ||
    providerConfig?.capabilities?.maxOutput ||
    4096
  );

  return Math.min(providerMax, Math.max(1024, needed));
}

module.exports = {
  parseAiHeaders,
  resolveAiTarget,
  normalizeTypeCounts,
  calculateMaxTokens,
};
