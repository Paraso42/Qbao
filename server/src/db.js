const { Pool } = require('pg');
// T19: 显式指定 .env 路径（dotenv 默认读进程 cwd，从其他目录启动会加载错/找不到配置）
require('dotenv').config({ path: __dirname + '/../.env' });

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  database: process.env.PGDATABASE || 'qbao',
  user: process.env.PGUSER || 'qbao',
  password: process.env.PGPASSWORD,
  port: parseInt(process.env.PGPORT || '5432'),
});

module.exports = { pool };