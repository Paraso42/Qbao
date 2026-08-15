// PM2 进程配置 — 按实际部署路径修改 script
module.exports = { apps: [{ name: 'qbao-api', script: '/srv/qbao/server/server.js', instances: 1, max_memory_restart: '1500M', env: { NODE_ENV: 'production' } }] };
