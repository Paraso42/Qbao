'use strict';

// AI 配置脱敏工具（v3.27）
// user_data.state_json 中禁止持久化用户 AI API Key。
// 写入前和读取时都经过这里，确保 apiKey / providerKeys 永不出现在服务端存储与响应中。

const SECRET_AI_CONFIG_FIELDS = ['apiKey', 'providerKeys'];

function sanitizeAiConfigObject(aiConfig) {
  if (!aiConfig || typeof aiConfig !== 'object' || Array.isArray(aiConfig)) {
    return aiConfig;
  }

  const clean = {};
  for (const key of Object.keys(aiConfig)) {
    if (!SECRET_AI_CONFIG_FIELDS.includes(key)) {
      clean[key] = aiConfig[key];
    }
  }
  return clean;
}

function sanitizeStateJson(stateJson) {
  if (!stateJson || typeof stateJson !== 'object' || Array.isArray(stateJson)) {
    return stateJson;
  }

  // 顶层浅拷贝，避免修改请求体/数据库对象本身。
  const clean = { ...stateJson };
  if (Object.prototype.hasOwnProperty.call(clean, 'aiConfig')) {
    clean.aiConfig = sanitizeAiConfigObject(clean.aiConfig);
  }
  return clean;
}

function hasSensitiveAiConfig(stateJson) {
  if (!stateJson || typeof stateJson !== 'object' || Array.isArray(stateJson)) return false;
  const aiConfig = stateJson.aiConfig;
  if (!aiConfig || typeof aiConfig !== 'object' || Array.isArray(aiConfig)) return false;
  return SECRET_AI_CONFIG_FIELDS.some((field) =>
    Object.prototype.hasOwnProperty.call(aiConfig, field)
  );
}

module.exports = {
  SECRET_AI_CONFIG_FIELDS,
  sanitizeAiConfigObject,
  sanitizeStateJson,
  hasSensitiveAiConfig,
};
