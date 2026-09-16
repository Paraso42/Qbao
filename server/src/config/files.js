'use strict';

// ============================================================
// files.js — 上传文件共享配置（T2 整改：上传白名单收敛到一处）
// 供 chat/files/issues 等上传通道共用，避免各路由各自的
// 白名单漂移（原 files.routes.v2.js 内联 ALLOWED_FILE_EXTS）。
// ============================================================

// 文件池/AI 出题资料：文档类（服务端解析用）
const POOL_ALLOWED_EXTS = ['.pdf', '.doc', '.docx', '.pptx', '.txt', '.md'];

// 图片类（聊天图片 / issue 附图 / 头像）
const IMAGE_ALLOWED_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];

// 聊天文件：文档 + 图片 + 常用压缩包（拒绝可执行/可脚本化类型）
const CHAT_ALLOWED_EXTS = [].concat(
  IMAGE_ALLOWED_EXTS,
  POOL_ALLOWED_EXTS,
  ['.xlsx', '.zip']
);

// 单次 AI 出题资料上传的文件数 / 总体积上限（P1-4）。
// 路由侧 upload.array('files', 10) 已限制个数；这里把「总体积」显式化，
// 免得以后有人单方面放宽 fileSize 就悄悄允许单请求 200MB。
const AI_UPLOAD_MAX_EXTS = 10;
const AI_UPLOAD_MAX_TOTAL_BYTES = 60 * 1024 * 1024;

module.exports = {
  POOL_ALLOWED_EXTS,
  IMAGE_ALLOWED_EXTS,
  CHAT_ALLOWED_EXTS,
  AI_UPLOAD_MAX_EXTS,
  AI_UPLOAD_MAX_TOTAL_BYTES,
};