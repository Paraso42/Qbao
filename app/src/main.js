// Qbao 前端入口（Vue 3 + Pinia）
// 初始化顺序：Pinia → 全局样式 → 运行时环境（桌面端 preload 注入）→ 挂载应用
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { initApp } from './core/boot'
import { initSecureAuth } from './services/api'
import { initSecureKeyStore } from './services/aiKeys'
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

  // P1.3：桌面端预热安全凭据（token / AI Key 从主进程 safeStorage 载入内存再挂载应用，
  // 保证首个请求与设置页读取同步可见；网页端两函数直接返回）
  await Promise.all([initSecureAuth(), initSecureKeyStore()]).catch((e) => {
    console.warn('[boot] 凭据预热失败（将按旧路径读取）', e && e.message)
  })

  const pinia = createPinia()
  const app = createApp(App)

  // P1-3：全局错误兜底。此前 Vue 渲染错误与未被 catch 的 Promise 拒绝只会进
  // console —— 桌面端尤其糟：控制台没人看，界面静默失效且无任何线索。
  // 这里统一「记日志 + 上报服务端」，并对渲染错误给出可见提示（同类错误 30s 内只提示一次，
  // 避免渲染循环把 toast 刷屏）。
  app.config.errorHandler = (err, instance, info) => {
    reportClientError(err, 'vue:' + info)
    const now = Date.now()
    if (now - lastRenderErrorToastAt > 30000) {
      lastRenderErrorToastAt = now
      try { pinia._s.get('ui')?.toast('界面出现异常，部分内容可能未正确显示', 'err', 6000) } catch (e) { /* 忽略 */ }
    }
  }
  window.addEventListener('unhandledrejection', (ev) => {
    // 用户主动取消的 AbortError / 正常的 401 已过期提示不重复上报
    const reason = ev && ev.reason
    if (reason && (reason.name === 'AbortError' || reason.__qbaoReported)) return
    reportClientError(reason, 'unhandledrejection')
  })

  app.use(pinia)
  app.mount('#app')
  initApp(pinia)
  // 供 QA 脚本/调试使用
  window.__pinia = pinia
}

// —— P1-3 客户端错误上报 ——
// 只上报发生频率受控的信息：错误名 + 消息 + 首个堆栈帧 + 页面路径，不含用户数据。
// 上报自身失败绝不再抛（否则会形成 unhandledrejection 递归）。
let lastRenderErrorToastAt = 0
const reportedSignatures = new Map()
function reportClientError(err, context) {
  try {
    if (!err) return
    const name = err.name || 'Error'
    const message = String(err.message || err)
    // 去重：同一 (context, name, message) 每 60s 最多上报一次，防止渲染错误刷爆服务端日志
    const sig = context + '|' + name + '|' + message
    const now = Date.now()
    const last = reportedSignatures.get(sig) || 0
    if (now - last < 60000) return
    reportedSignatures.set(sig, now)
    if (reportedSignatures.size > 50) reportedSignatures.clear()
    const stack = typeof err.stack === 'string' ? err.stack.split('\n').slice(0, 3).join(' | ') : ''
    const payload = JSON.stringify({
      name, message, stack, context,
      url: (typeof location !== 'undefined' ? location.pathname : ''),
      ua: (typeof navigator !== 'undefined' ? navigator.userAgent : ''),
    })
    console.error('[client-error]', payload)
    // keepalive 保证页面卸载中的错误也能送达；接口不可用时静默放弃
    if (typeof fetch === 'function') {
      fetch('/api/v1/client-errors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(() => {})
    }
  } catch (e) { /* 上报失败必须静默 */ }
}

boot().catch((e) => {
  // 引导阶段失败（KaTeX/凭据预热之外的意外）——把线索留在控制台并尽量让用户看到
  console.error('[boot] 启动失败:', e)
  try {
    const el = document.getElementById('app')
    if (el && !el.childElementCount) {
      el.innerHTML = '<div style="padding:24px;font:14px/1.6 system-ui;color:#666">应用启动失败，请刷新页面重试。</div>'
    }
  } catch (err) { /* 忽略 */ }
})
