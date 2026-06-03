module.exports = { apps: [{ name: 'qbao-api', script: '/home/qbao/backend/server.js', instances: 1, max_memory_restart: '1500M', env: { NODE_ENV: 'production' } }] };
