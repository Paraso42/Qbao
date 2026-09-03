'use strict';

// Qbao 后端 ESLint 配置（P0.4 引入）——入口基线规则集。
// 策略：只做硬错误拦截（未定义变量/重复声明/重复键），样式类先 warning 留痕。
// Node 全局内联维护（避免依赖 globals 包，npx 环境也能解析）。
const NODE_GLOBALS = {
  require: 'readonly', module: 'readonly', exports: 'readonly',
  __dirname: 'readonly', __filename: 'readonly',
  process: 'readonly', console: 'readonly', Buffer: 'readonly', global: 'readonly',
  URL: 'readonly', URLSearchParams: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  setImmediate: 'readonly', clearImmediate: 'readonly', queueMicrotask: 'readonly',
  TextEncoder: 'readonly', TextDecoder: 'readonly', AbortController: 'readonly', AbortSignal: 'readonly',
  fetch: 'readonly', Headers: 'readonly', Request: 'readonly', Response: 'readonly', FormData: 'readonly',
  Blob: 'readonly', File: 'readonly', crypto: 'readonly',
  ReadableStream: 'readonly', DOMException: 'readonly',
  structuredClone: 'readonly', performance: 'readonly', atob: 'readonly', btoa: 'readonly',
};

module.exports = [
  {
    files: ['**/*.js'],
    ignores: ['node_modules/**'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: NODE_GLOBALS,
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-dupe-keys': 'error',
      'no-redeclare': 'error',
      'no-func-assign': 'error',
      'no-constant-condition': ['warn', { checkLoops: false }],
      'no-empty': 'warn',
    },
  },
  // vitest 注入的测试全局变量（测试文件不显式 import 它们, 与现有写法保持一致）
  {
    files: ['test/**/*.js'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        vi: 'readonly',
      },
    },
  },
];
