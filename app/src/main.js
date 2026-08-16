// Qbao 前端入口（Vue 3 + Pinia）
// 初始化顺序：Pinia → 全局样式 → 运行时环境（桌面端 preload 注入）→ 挂载应用
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { initApp } from './core/boot'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import './styles/dark.css'
import './styles/responsive.css'

// KaTeX 外部经典脚本（public/vendor/katex）：
// 保持文件形式加载，避免 singlefile 把字体以 data-URI 内联进 HTML 导致体积膨胀。
// 先确保 katex 全局就绪再挂载应用，保证首次渲染的公式即可正确排版。
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src
    s.onload = resolve
    s.onerror = () => reject(new Error('加载失败: ' + src))
    document.head.appendChild(s)
  })
}

async function boot() {
  const css = document.createElement('link')
  css.rel = 'stylesheet'
  css.href = './vendor/katex/katex.min.css'
  document.head.appendChild(css)

  try {
    await loadScript('./vendor/katex/katex.min.js')
  } catch (e) {
    console.warn('[boot] KaTeX 加载失败，公式将退化为纯文本', e)
  }

  const pinia = createPinia()
  const app = createApp(App)
  app.use(pinia)
  app.mount('#app')
  initApp(pinia)
}

boot()
