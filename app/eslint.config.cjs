'use strict';

// Qbao 前端 ESLint 配置（P0.4 引入）——入口基线规则集。
// 策略：只做硬错误拦截（未定义变量/重复声明/重复键），样式类先 warning 留痕；
// .vue 文件由 Vite 构建门禁覆盖（本配置暂只覆盖 src/**/*.js，Vue SFC 待后续扩展）。
// 浏览器全局内联维护（避免依赖 globals 包，npx 环境也能解析）。
const BROWSER_GLOBALS = {
  window: 'readonly', document: 'readonly', localStorage: 'readonly', sessionStorage: 'readonly',
  location: 'readonly', navigator: 'readonly', history: 'readonly', screen: 'readonly',
  console: 'readonly', fetch: 'readonly', FormData: 'readonly', Blob: 'readonly', File: 'readonly', FileReader: 'readonly',
  URL: 'readonly', URLSearchParams: 'readonly', Headers: 'readonly', Request: 'readonly', Response: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly',
  crypto: 'readonly', atob: 'readonly', btoa: 'readonly', structuredClone: 'readonly', performance: 'readonly',
  TextEncoder: 'readonly', TextDecoder: 'readonly', AbortController: 'readonly', AbortSignal: 'readonly',
  Event: 'readonly', CustomEvent: 'readonly', MutationObserver: 'readonly', IntersectionObserver: 'readonly',
  Node: 'readonly', Element: 'readonly', HTMLElement: 'readonly', HTMLInputElement: 'readonly', HTMLTextAreaElement: 'readonly',
  KeyboardEvent: 'readonly', MouseEvent: 'readonly', DragEvent: 'readonly', ClipboardEvent: 'readonly', FocusEvent: 'readonly',
  HTMLCanvasElement: 'readonly', CanvasRenderingContext2D: 'readonly', SVGElement: 'readonly',
  Image: 'readonly', Audio: 'readonly', DOMParser: 'readonly', XMLSerializer: 'readonly',
  indexedDB: 'readonly', requestIdleCallback: 'readonly',
  getComputedStyle: 'readonly', matchMedia: 'readonly', queueMicrotask: 'readonly',
};

module.exports = [
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: BROWSER_GLOBALS,
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
];
