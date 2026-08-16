'use strict';

// AI Provider/Model 能力目录（v3.27）
// 这是后端 AI 配置的唯一事实源。
// 前端 GET /api/v1/ai/providers 读取这里，不再维护不准确的本地 fallback；
// ai.routes.js 在生成/测试前用这里校验 provider 与 model 的匹配关系。

const AI_PROVIDER_CATALOG = {
  ecnu: {
    id: 'ecnu',
    name: 'ECNU (华师大)',
    apiStyle: 'openai-compatible',
    authStyle: 'bearer',
    baseUrl: 'https://chat.ecnu.edu.cn/open/api/v1',
    supportsCustomBaseUrl: false,
    capabilities: {
      streaming: true,
      jsonSchema: true,
      jsonObject: false,
      vision: false,
      maxContext: 32768,
      maxOutput: 8192,
    },
    defaults: { temperature: 0.7, maxTokens: 4096 },
    models: [
      { id: 'ecnu-turbo', name: 'ecnu-turbo', streaming: true, jsonSchema: true, context: 16384, maxOutput: 4096 },
      { id: 'ecnu-plus', name: 'ecnu-plus', streaming: true, jsonSchema: true, context: 32768, maxOutput: 8192 },
      { id: 'ecnu-max', name: 'ecnu-max', streaming: true, jsonSchema: true, context: 32768, maxOutput: 8192 },
    ],
  },

  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    apiStyle: 'openai-compatible',
    authStyle: 'bearer',
    baseUrl: 'https://api.deepseek.com',
    supportsCustomBaseUrl: true,
    capabilities: {
      streaming: true,
      jsonSchema: false,
      jsonObject: true,
      vision: false,
      maxContext: 64000,
      maxOutput: 8192,
    },
    defaults: { temperature: 0.7, maxTokens: 4096 },
    models: [
      { id: 'deepseek-v4-flash', name: 'deepseek-v4-flash', streaming: true, jsonSchema: false, context: 64000, maxOutput: 8192 },
      { id: 'deepseek-v4-pro', name: 'deepseek-v4-pro', streaming: true, jsonSchema: false, context: 64000, maxOutput: 8192 },
    ],
  },

  openai: {
    id: 'openai',
    name: 'OpenAI ChatGPT',
    apiStyle: 'openai-compatible',
    authStyle: 'bearer',
    baseUrl: 'https://api.openai.com/v1',
    supportsCustomBaseUrl: true,
    capabilities: {
      streaming: true,
      jsonSchema: true,
      jsonObject: true,
      vision: true,
      maxContext: 128000,
      maxOutput: 16384,
    },
    defaults: { temperature: 0.7, maxTokens: 4096 },
    models: [
      { id: 'gpt-4o', name: 'gpt-4o', streaming: true, jsonSchema: true, context: 128000, maxOutput: 16384 },
      { id: 'gpt-4o-mini', name: 'gpt-4o-mini', streaming: true, jsonSchema: true, context: 128000, maxOutput: 16384 },
      { id: 'gpt-4.1', name: 'gpt-4.1', streaming: true, jsonSchema: true, context: 1048576, maxOutput: 32768 },
    ],
  },

  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    apiStyle: 'gemini',
    authStyle: 'query-param',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    supportsCustomBaseUrl: false,
    capabilities: {
      streaming: true,
      jsonSchema: false,
      jsonObject: true,
      vision: true,
      maxContext: 1048576,
      maxOutput: 8192,
    },
    defaults: { temperature: 0.7, maxTokens: 4096 },
    models: [
      { id: 'gemini-2.5-flash', name: 'gemini-2.5-flash', streaming: true, jsonSchema: false, context: 1048576, maxOutput: 8192 },
      { id: 'gemini-2.5-pro', name: 'gemini-2.5-pro', streaming: true, jsonSchema: false, context: 1048576, maxOutput: 65536 },
    ],
  },
};

function getProviderCatalogEntry(providerName) {
  const id = String(providerName || '').toLowerCase();
  return AI_PROVIDER_CATALOG[id] || null;
}

function getModelCatalogEntry(providerName, modelId) {
  const provider = getProviderCatalogEntry(providerName);
  if (!provider) return null;
  const model = String(modelId || '').trim();
  return provider.models.find((m) => m.id === model) || null;
}

function getAllProviderCatalogEntries() {
  return Object.values(AI_PROVIDER_CATALOG).map((provider) => ({
    id: provider.id,
    name: provider.name,
    apiStyle: provider.apiStyle,
    authStyle: provider.authStyle,
    baseUrl: provider.baseUrl,
    supportsCustomBaseUrl: provider.supportsCustomBaseUrl,
    capabilities: { ...provider.capabilities },
    defaults: { ...provider.defaults },
    models: provider.models.map((model) => ({ ...model })),
  }));
}

module.exports = {
  AI_PROVIDER_CATALOG,
  getProviderCatalogEntry,
  getModelCatalogEntry,
  getAllProviderCatalogEntries,
};
