'use strict';

// 进程入口：加载环境变量、组装应用、监听端口。
// 服务器无 IPv6 出网时，Node fetch（AI Provider 请求）默认 IPv6 优先会黑洞超时 → 强制 IPv4 优先。
require('dns').setDefaultResultOrder('ipv4first');
require('dotenv').config({ path: __dirname + '/.env' });

// 启动即校验 JWT 密钥，避免使用示例值导致全员可伪造 token。
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET === 'change_me_to_a_long_random_string') {
  console.error('[startup] JWT_SECRET 未配置或仍为示例值，请运行: openssl rand -hex 32 并写入 server/.env');
  process.exit(1);
}
const { startAiTaskWorker, markStaleTasksFailed } = require('./src/services/aiTaskService');
const { startExpiryJob } = require('./src/services/pointsService');
const { createApp } = require('./app');

const PORT = process.env.PORT || 3000;
createApp().listen(PORT, () => {
  console.log('Qbao API running on port ' + PORT);
  // 清理上次进程遗留的 queued/running 任务（API Key 在内存中已丢失）
  markStaleTasksFailed().finally(() => {
    startAiTaskWorker();
    console.log('AI task worker started');
  });
  // 积分：学期清零（每年 2/1、8/1）× 每日低峰对账定时任务
  startExpiryJob();
});