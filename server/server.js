const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
require('dotenv').config({ path: __dirname + '/.env' });
const { pool } = require('./src/db');

const app = express();
const PORT = process.env.PORT || 3000;

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

// Serve uploaded files (avatars, pool files for download)
const path = require('path');
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
require('./src/routes/backup.routes')(app);
require('./src/routes/ai.routes')(app);
require('./src/routes/share.routes')(app);
require('./src/routes/notices.routes')(app);
require('./src/routes/users.routes')(app);
require('./src/routes/quiz.routes')(app);
require('./src/routes/files.routes')(app);
require('./src/routes/issues.routes')(app);
require("./src/routes/chat.routes")(app);

app.listen(PORT, () => console.log(`Qbao API running on port ${PORT}`));
