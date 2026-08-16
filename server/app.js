'use strict';

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { pool } = require('./src/db');
const { notFoundHandler, errorHandler } = require('./src/lib/errorHandler');

// 组装 Express 应用（不监听端口）：server.js 启动进程与 supertest 测试共用。
function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  // CORS 白名单：同源请求与桌面端 file://（Origin: null）放行；
  // 其余来源需匹配 CORS_ORIGIN 环境变量（逗号分隔）。同源请求无需 ACAO 头，不受影响。
  const corsWhitelist = (process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
  app.use(cors({
    origin: function (origin, cb) {
      if (!origin || origin === 'null') return cb(null, true);
      if (corsWhitelist.includes(origin)) return cb(null, true);
      cb(null, false);
    }
  }));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // 上传文件静态服务（头像、文件池下载）
  app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
  app.use('/avatars', express.static(path.join(__dirname, '../uploads/avatars')));

  const authLimiter = rateLimit({ windowMs: 60000, max: 20, message: { error: '请求过于频繁' }, keyGenerator: (req) => req.ip });
  const generalLimiter = rateLimit({ windowMs: 60000, max: 120, keyGenerator: (req) => req.ip });
  app.use('/api/v1/auth/', authLimiter);
  app.use('/api/v1/', generalLimiter);

  app.get('/health', async (req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', version: '2.0', db: 'connected' });
    } catch (e) {
      res.status(503).json({ status: 'error', db: 'disconnected' });
    }
  });

  require('./src/routes/auth.routes')(app);
  require('./src/routes/data.routes')(app);
  require('./src/routes/backup.routes.v2')(app);
  require('./src/routes/ai.routes')(app);
    require('./src/routes/aiTasks.routes')(app);
  require('./src/routes/share.routes.v2')(app);
  require('./src/routes/notices.routes.v2')(app);
  require('./src/routes/users.routes.v2')(app);
  require('./src/routes/quiz.routes')(app);
  require('./src/routes/files.routes.v2')(app);
  require('./src/routes/issues.routes.v2')(app);
  require('./src/routes/chat.routes.v2')(app);

  // 统一兜底：404 + 全局错误处理（必须最后注册）
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
