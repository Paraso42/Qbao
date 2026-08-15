'use strict';

// 进程入口：加载环境变量、组装应用、监听端口。
require('dotenv').config({ path: __dirname + '/.env' });
const { createApp } = require('./app');

const PORT = process.env.PORT || 3000;
createApp().listen(PORT, () => console.log('Qbao API running on port ' + PORT));
