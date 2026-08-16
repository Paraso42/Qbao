import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteSingleFile } from 'vite-plugin-singlefile'

// Qbao 前端构建配置
// - base './'：产物全相对路径，兼容桌面端 file:// 加载
// - singlefile：JS/CSS 内联进 index.html（file:// 下 ES modules 会被 CORS 拦截，必须内联）
// - KaTeX 位于 public/vendor/katex，保持外部经典脚本，不做内联（避免字体 data-URI 膨胀）
export default defineConfig({
  base: './',
  plugins: [vue(), viteSingleFile({ deleteInlinedFiles: true })],
  build: {
    target: 'chrome105',
    cssCodeSplit: false,
    reportCompressedSize: false,
    outDir: 'dist'
  },
  server: {
    port: 5173,
    strictPort: false
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.js']
  }
})
