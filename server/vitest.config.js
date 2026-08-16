'use strict';

const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
    globals: true,
      // 测试通过替换全局 pool.query 单例模拟数据库，必须串行执行测试文件，避免互相覆盖。
      fileParallelism: false,
  },
});
