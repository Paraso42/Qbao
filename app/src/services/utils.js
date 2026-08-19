// 通用工具（自 legacy utils.js + state.js 抽取，语义不变）
import { API_BASE } from '../core/env'

export function isObjType(t) { return t === 'single' || t === 'judge' }

// 将服务端返回的相对媒体 URL（avatars/…、/avatars/…、uploads/…、/uploads/…）
// 解析为可访问的绝对 URL：网页版取当前 origin，桌面版（file://）取 API_BASE origin。
// 绝对 URL（http(s)/data/blob）原样返回。
export function resolveMediaUrl(url) {
  if (!url || typeof url !== 'string') return ''
  if (/^(https?:|data:|blob:)/i.test(url)) return url
  let origin = ''
  if (/^https?:/i.test(API_BASE)) {
    try { origin = new URL(API_BASE).origin } catch (e) { origin = '' }
  }
  if (!origin && typeof location !== 'undefined') origin = location.origin
  if (url.charAt(0) === '/') return origin + url
  if (url.indexOf('avatars/') === 0 || url.indexOf('uploads/') === 0) return origin + '/' + url
  return url
}

export function getCi(q, answer) {
  if (!q) return false
  if (answer === -1) return false // 未作答判为错误
  if (q.type === 'term' || q.type === 'short') return true
  if (q.type === 'single' || q.type === 'judge') return answer === q.answer
  return null
}

export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

export function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1048576).toFixed(1) + ' MB'
}

export function generateMaterialId() {
  return 'mat_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6)
}

export function generateId(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6)
}

export function escapeHtml(text) {
  if (typeof text !== 'string') return String(text ?? '')
  const d = document.createElement('div')
  d.textContent = text
  return d.innerHTML
}

// KaTeX + Markdown 渲染（同 legacy renderMarkdown；katex 为全局脚本注入）
export function renderMarkdown(text) {
  if (typeof text !== 'string') return escapeHtml(String(text ?? ''))
  const katexLib = (typeof window !== 'undefined' && window.katex) || null

  // Step 1: $$...$$ display math 占位
  const displayMath = []
  let s = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => {
    if (katexLib) {
      try { displayMath.push(katexLib.renderToString(m.trim(), { displayMode: true, throwOnError: false })) }
      catch (e) { displayMath.push('<code class="katex-error">' + escapeHtml(m.trim()) + '</code>') }
    } else {
      displayMath.push('<code>' + escapeHtml(m.trim()) + '</code>')
    }
    return '%%DM' + (displayMath.length - 1) + '%%'
  })

  // Step 2: $...$ inline math 占位
  const inlineMath = []
  s = s.replace(/\$([^\$]+?)\$/g, (_, m) => {
    if (katexLib) {
      try { inlineMath.push(katexLib.renderToString(m.trim(), { displayMode: false, throwOnError: false })) }
      catch (e) { inlineMath.push('<code class="katex-error">' + escapeHtml(m.trim()) + '</code>') }
    } else {
      inlineMath.push('<code>' + escapeHtml(m.trim()) + '</code>')
    }
    return '%%IM' + (inlineMath.length - 1) + '%%'
  })

  // Step 3: 其余文本转义
  s = escapeHtml(s)

  // Step 4: 恢复 KaTeX HTML
  s = s.replace(/%%DM(\d+)%%/g, (_, i) => displayMath[parseInt(i)])
  s = s.replace(/%%IM(\d+)%%/g, (_, i) => inlineMath[parseInt(i)])

  // Step 5: 安全的 Markdown 标记
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>')
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>')
  s = s.replace(/\n/g, '<br>')
  return s
}

// 带重试的 fetch（自 legacy ai-workflow.js fetchWithRetry 语义）
export async function fetchWithRetry(url, options, maxAttempts = 3, retryDelayMs = 5000) {
  let lastErr = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, options)
      if (!res.ok) {
        lastErr = new Error('HTTP ' + res.status)
        if (attempt < maxAttempts) { await sleep(retryDelayMs * attempt); continue }
        return res
      }
      return res
    } catch (e) {
      lastErr = e
      if (attempt < maxAttempts) { await sleep(retryDelayMs * attempt); continue }
      throw e
    }
  }
  throw lastErr
}

export function clamp(v, min, max) { return Math.max(min, Math.min(max, v)) }

// 头像裁剪导出参数（AvatarCropDialog 使用）：把正方形裁剪视口（边长 viewport）按“所见即所得”
// 映射到图片自然坐标。fit 为 cover 适配后的几何 { naturalW, naturalH, displayW, displayH, offsetX, offsetY }，
// zoomPct 为当前缩放百分比。返回 { srcX, srcY, srcSize, displayW, displayH }：
// - 视口左上角 (0,0) 对应图片自然坐标 (srcX, srcY)（可为负，drawImage 会裁剪图片外的透明区域）
// - srcSize 为视口边长对应的图片自然边长；导出中心恒等于视口中心映射点
export function avatarCropSource(fit, zoomPct, viewport = 280) {
  const s = zoomPct / 100
  const displayW = fit.displayW * s
  const displayH = fit.displayH * s
  // 归一化 -0 → 0（避免 canvas drawImage 源矩形出现 -0）
  const zero = (v) => (v === 0 ? 0 : v)
  return {
    srcX: zero(-fit.offsetX / displayW * fit.naturalW),
    srcY: zero(-fit.offsetY / displayH * fit.naturalH),
    srcSize: viewport / displayW * fit.naturalW,
    displayW,
    displayH
  }
}
