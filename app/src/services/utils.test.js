import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { avatarCropSource, renderMarkdown } from './utils'
import * as env from '../core/env'

// resolveMediaUrl 依赖 API_BASE / location；在此用可控值测试
function freshResolve() {
  return import('./utils').then((m) => m.resolveMediaUrl)
}

describe('resolveMediaUrl', () => {
  const realLocation = globalThis.location
  const realRuntime = globalThis.window

  beforeEach(() => {
    // 默认：网页版同源（API_BASE = /api/v1, location.origin = https://qbao.example）
    globalThis.window = { __QBAO_RUNTIME__: null }
    globalThis.location = { origin: 'https://qbao.example' }
    vi.resetModules()
  })

  afterEach(() => {
    globalThis.window = realRuntime
    globalThis.location = realLocation
    vi.resetModules()
  })

  it('绝对 URL（http/data/blob）原样返回', async () => {
    const resolveMediaUrl = await freshResolve()
    expect(resolveMediaUrl('https://cdn.example/a.jpg')).toBe('https://cdn.example/a.jpg')
    expect(resolveMediaUrl('data:image/jpeg;base64,xxxx')).toBe('data:image/jpeg;base64,xxxx')
    expect(resolveMediaUrl('blob:http://x/1')).toBe('blob:http://x/1')
  })

  it('网页版：相对 avatars/… 解析为当前 origin 绝对 URL', async () => {
    const resolveMediaUrl = await freshResolve()
    expect(resolveMediaUrl('avatars/2.jpg')).toBe('https://qbao.example/avatars/2.jpg')
    expect(resolveMediaUrl('/avatars/2.jpg')).toBe('https://qbao.example/avatars/2.jpg')
    expect(resolveMediaUrl('uploads/avatars/2.jpg')).toBe('https://qbao.example/uploads/avatars/2.jpg')
    expect(resolveMediaUrl('/uploads/chat/a.png')).toBe('https://qbao.example/uploads/chat/a.png')
  })

  it('桌面版：API_BASE 为绝对 URL 时取其 origin', async () => {
    globalThis.window = { __QBAO_RUNTIME__: { apiBase: 'https://api.example.com/api/v1', isDesktop: true } }
    const resolveMediaUrl = await freshResolve()
    expect(resolveMediaUrl('avatars/2.jpg')).toBe('https://api.example.com/avatars/2.jpg')
    expect(resolveMediaUrl('/uploads/avatars/2.jpg')).toBe('https://api.example.com/uploads/avatars/2.jpg')
  })

  it('空值/未知相对路径兜底', async () => {
    const resolveMediaUrl = await freshResolve()
    expect(resolveMediaUrl('')).toBe('')
    expect(resolveMediaUrl(null)).toBe('')
    expect(resolveMediaUrl('other/path')).toBe('other/path')
  })

  it('T4 伪协议防护：javascript:/vbscript:/data:text/html 均返回空串', async () => {
    const resolveMediaUrl = await freshResolve()
    expect(resolveMediaUrl('javascript:alert(1)')).toBe('')
    expect(resolveMediaUrl('vbscript:msgbox(1)')).toBe('')
    expect(resolveMediaUrl('data:text/html,<script>alert(1)</script>')).toBe('')
    expect(resolveMediaUrl('JaVaScRiPt:alert(1)')).toBe('')
    expect(resolveMediaUrl('  javascript:alert(1)')).toBe('')
  })

  it('T4 白名单：仅图片类 data: 与 blob: 放行', async () => {
    const resolveMediaUrl = await freshResolve()
    expect(resolveMediaUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA')
    expect(resolveMediaUrl('data:image/webp;base64,AAAA')).toBe('data:image/webp;base64,AAAA')
    expect(resolveMediaUrl('blob:https://qbao.example/abc')).toBe('blob:https://qbao.example/abc')
    expect(resolveMediaUrl('data:application/javascript;base64,AAAA')).toBe('')
    expect(resolveMediaUrl('data:image/svg+xml;base64,AAAA')).toBe('')
  })
})

// avatarCropSource：裁剪导出必须与视口显示完全一致（所见即所得 regression 测试）
const VP = 280
// cover 适配：竖图 300x400
const portrait = { naturalW: 300, naturalH: 400, displayW: 280, displayH: 373.3333333333333, offsetX: 0, offsetY: -46.666666666666664 }
// cover 适配：横图 400x300
const landscape = { naturalW: 400, naturalH: 300, displayW: 373.3333333333333, displayH: 280, offsetX: -46.666666666666664, offsetY: 0 }

describe('avatarCropSource', () => {
  it('拖到上部边界时（offsetY=0）srcY 必须为 0，导出不再包含图片上方空白', () => {
    const r = avatarCropSource({ ...portrait, offsetY: 0 }, 120, VP)
    expect(r.srcY).toBe(0)
    // 缩放后图片高 448 > 280，若按旧算法会得到 srcY=-75（导出含上方透明区）
    expect(r.srcY).toBeGreaterThan(-75)
  })

  it('拖到左边界时（offsetX=0）srcX 必须为 0', () => {
    const r = avatarCropSource({ ...landscape, offsetX: 0 }, 100, VP)
    expect(r.srcX).toBe(0)
  })

  it('居中时导出中心 = 视口中心映射的图片坐标', () => {
    const r = avatarCropSource(portrait, 100, VP)
    expect(r.srcX + r.srcSize / 2).toBeCloseTo((VP / 2 - portrait.offsetX) / portrait.displayW * portrait.naturalW, 6)
    expect(r.srcY + r.srcSize / 2).toBeCloseTo((VP / 2 - portrait.offsetY) / portrait.displayH * portrait.naturalH, 6)
  })

  it('任意缩放级别下导出中心始终等于视口中心映射点（所见即所得）', () => {
    for (const zoomPct of [100, 120, 150, 200]) {
      const r = avatarCropSource(landscape, zoomPct, VP)
      const dW = landscape.displayW * zoomPct / 100
      const dH = landscape.displayH * zoomPct / 100
      expect(r.srcX + r.srcSize / 2).toBeCloseTo((VP / 2 - landscape.offsetX) / dW * landscape.naturalW, 6)
      expect(r.srcY + r.srcSize / 2).toBeCloseTo((VP / 2 - landscape.offsetY) / dH * landscape.naturalH, 6)
      expect(r.srcSize).toBeCloseTo(VP / dW * landscape.naturalW, 6)
    }
  })

  it('srcSize 使用横向或纵向尺度结果一致（均匀缩放）', () => {
    for (const fit of [portrait, landscape]) {
      for (const zoomPct of [100, 125, 180]) {
        const r = avatarCropSource(fit, zoomPct, VP)
        const s = zoomPct / 100
        expect(r.srcSize).toBeCloseTo(VP / (fit.displayW * s) * fit.naturalW, 6)
        expect(r.srcSize).toBeCloseTo(VP / (fit.displayH * s) * fit.naturalH, 6)
      }
    }
  })

  it('贴合视口尺寸的图片（正方形）在任意偏移下导出与显示一致', () => {
    const square = { naturalW: 200, naturalH: 200, displayW: 280, displayH: 280, offsetX: -40, offsetY: -70 }
    const r = avatarCropSource(square, 100, VP)
    expect(r.srcX).toBeCloseTo(40 / 280 * 200, 6)
    expect(r.srcY).toBeCloseTo(70 / 280 * 200, 6)
    expect(r.srcSize).toBe(200)
  })
})

// renderMarkdown（P0.6：占位符盐防伪造 —— 测试环境无 katex，公式回退为 <code> 包裹）
describe('renderMarkdown', () => {
  it('正常行内/块级公式渲染（katex 缺失时回退 <code>）', () => {
    const out = renderMarkdown('行内 $x_1$ 与块级 $$\sum_{i=1}^{n} x_i$$')
    expect(out).toContain('<code>x_1</code>')
    expect(out).toContain('<code>\sum_{i=1}^{n} x_i</code>')
  })

  it('P0.6 伪造占位符 %%DM0%%/%%IM1%% 不再被还原为 undefined 或错位 HTML', () => {
    const out = renderMarkdown('题目 %%DM0%% 内容 $x$ 结束 %%IM1%%')
    expect(out).toContain('%%DM0%%')
    expect(out).toContain('%%IM1%%')
    expect(out).toContain('<code>x</code>')
    expect(out.includes('undefined')).toBe(false)
  })

  it('P0.6 多公式编号不串位（真实占位按序还原）', () => {
    const out = renderMarkdown('$a$、$b$ 与 $$c$$ 混合')
    expect(out).toContain('<code>a</code>')
    expect(out).toContain('<code>b</code>')
    expect(out).toContain('<code>c</code>')
  })

  it('HTML 仍被转义（XSS 面不回退）', () => {
    const out = renderMarkdown('<script>alert(1)</script> 与 $x$')
    expect(out.includes('<script>')).toBe(false)
    expect(out).toContain('&lt;script&gt;')
  })
})
// —— 受保护媒体 ticket（P0-1 回归）——
// 服务端给聊天附件/工单图片签名 ?t=exp.sig；前端只做「路径判断 + 原样带票」。
describe('媒体 ticket 透传', () => {
  const realLocation = globalThis.location
  const realRuntime = globalThis.window
  beforeEach(() => {
    // 网页版同源：resolveMediaUrl/isMediaPath 的 origin 由 location.origin 给出
    globalThis.window = { __QBAO_RUNTIME__: null }
    globalThis.location = { origin: 'https://qbao.example' }
    vi.resetModules()
  })
  afterEach(() => {
    globalThis.window = realRuntime
    globalThis.location = realLocation
    vi.resetModules()
  })

  it('isMediaPath：只认两个受保护前缀，且忽略 query/hash', async () => {
    const { isMediaPath } = await import('./utils')
    expect(isMediaPath('/api/v1/chat/files/a.png')).toBe(true)
    expect(isMediaPath('/api/v1/issues/images/b.jpg?t=1.2')).toBe(true)
    expect(isMediaPath('/api/v1/issues/images/b.jpg#frag')).toBe(true)
    // 非受保护：静态头像、外部图床、空值
    expect(isMediaPath('/avatars/2.jpg')).toBe(false)
    expect(isMediaPath('/uploads/chat/a.png')).toBe(false)
    expect(isMediaPath('https://cdn.example/a.jpg')).toBe(false)
    expect(isMediaPath('')).toBe(false)
    expect(isMediaPath(null)).toBe(false)
    expect(isMediaPath(undefined)).toBe(false)
  })

  it('isMediaPath：自身 origin 的绝对 URL 也算受保护媒体', async () => {
    const { isMediaPath } = await import('./utils')
    expect(isMediaPath('https://qbao.example/api/v1/chat/files/a.png')).toBe(true)
    expect(isMediaPath('https://qbao.example/api/v1/issues/images/b.jpg?t=1.2')).toBe(true)
    // 关键安全边界：**外部主机**上的同形路径不算 —— 否则会把本服务的 ticket 送给第三方
    expect(isMediaPath('https://evil.example/api/v1/chat/files/a.png')).toBe(false)
    expect(isMediaPath('https://evil.example/api/v1/issues/images/b.jpg?t=1.2')).toBe(false)
  })

  it('withMediaTicket：非受保护路径原样返回（不注入任何参数）', async () => {
    const { withMediaTicket } = await import('./utils')
    expect(withMediaTicket('/avatars/2.jpg', '/avatars/2.jpg?t=9.9')).toBe('/avatars/2.jpg')
    expect(withMediaTicket('https://cdn.example/a.jpg', 'https://cdn.example/a.jpg?t=9.9'))
      .toBe('https://cdn.example/a.jpg')
  })

  it('withMediaTicket：受保护路径原样搬运服务端下发的 ticket', async () => {
    const { withMediaTicket } = await import('./utils')
    expect(withMediaTicket('/api/v1/chat/files/a.png', '/api/v1/chat/files/a.png?t=123.abc-_'))
      .toBe('/api/v1/chat/files/a.png?t=123.abc-_')
  })

  it('withMediaTicket：已带 query 时用 & 追加，不破坏原参数', async () => {
    const { withMediaTicket } = await import('./utils')
    expect(withMediaTicket('/api/v1/chat/files/a.png?dl=1', '/api/v1/chat/files/a.png?t=5.sig'))
      .toBe('/api/v1/chat/files/a.png?dl=1&t=5.sig')
  })

  it('withMediaTicket：服务端没给 ticket（未签发/登录态过期）时保持原 URL', async () => {
    const { withMediaTicket } = await import('./utils')
    expect(withMediaTicket('/api/v1/chat/files/a.png', '/api/v1/chat/files/a.png'))
      .toBe('/api/v1/chat/files/a.png')
    expect(withMediaTicket('/api/v1/chat/files/a.png', undefined)).toBe('/api/v1/chat/files/a.png')
  })

  it('withMediaTicket：服务端下发的 URL 完全不含 t 时不注入', async () => {
    const { withMediaTicket } = await import('./utils')
    expect(withMediaTicket('/api/v1/issues/images/b.jpg', 'https://qbao.example/api/v1/issues/images/b.jpg?x=1'))
      .toBe('/api/v1/issues/images/b.jpg')
  })

  it('resolveMediaSrc：相对路径 → 绝对 URL + ticket（组件真实调用形态）', async () => {
    const { resolveMediaSrc } = await import('./utils')
    expect(resolveMediaSrc('/api/v1/chat/files/a.png', '/api/v1/chat/files/a.png?t=77.sig'))
      .toBe('https://qbao.example/api/v1/chat/files/a.png?t=77.sig')
    // 只传干净路径（服务端未签发）→ 绝对化但不带票，由端点返回 401 触发登录引导
    expect(resolveMediaSrc('/api/v1/chat/files/a.png'))
      .toBe('https://qbao.example/api/v1/chat/files/a.png')
    // 普通头像不受影响
    expect(resolveMediaSrc('avatars/2.jpg', 'avatars/2.jpg'))
      .toBe('https://qbao.example/avatars/2.jpg')
  })

  // —— v3.37.2 事故回归：ticket 被追加两次 → 服务端 req.query.t 变逗号串 → 401 裂图 ——
  // 线上真实形态：服务端 GET /chat/rooms/:id/messages 与 /chat/upload 直接下发带票 URL，
  // 组件把**这一个**地址同时当作 clean 与 mediaUrl 传入（ChatMessages.imageSrcs）。
  it('withMediaTicket：入参已带 ticket 时不再追加（事故形态，必须恒等于入参）', async () => {
    const { withMediaTicket } = await import('./utils')
    const signed = '/api/v1/chat/files/a.png?t=1789563551422.8NIyUaEmdEnyZgRemdIoNCjdKizMoOGhZsoH0R7xFJM'
    expect(withMediaTicket(signed, signed)).toBe(signed)
    // 服务端下发的绝对地址同理
    const abs = 'https://qbao.example/api/v1/issues/images/b.jpg?t=5.sig'
    expect(withMediaTicket(abs, abs)).toBe(abs)
  })

  it('resolveMediaSrc：服务端下发的带票 URL 原样保留（只有一个 t 参数）', async () => {
    const { resolveMediaSrc } = await import('./utils')
    const signed = '/api/v1/chat/files/a.png?t=77.sig'
    const out = resolveMediaSrc(signed, signed)
    expect(out).toBe('https://qbao.example/api/v1/chat/files/a.png?t=77.sig')
    expect(out.match(/[?&]t=/g).length).toBe(1)
  })

  it('withMediaTicket：URL 里已有旧 ticket 时不会被替换成第二个（防 &t= 叠加）', async () => {
    const { withMediaTicket } = await import('./utils')
    // 理论上不该出现（第一道幂等已挡住），这里锁定「结果里 t 参数最多一个」
    const out = withMediaTicket('/api/v1/chat/files/a.png?t=1.old', '/api/v1/chat/files/a.png?t=2.new')
    expect(out.match(/[?&]t=/g).length).toBe(1)
    expect(out).toContain('t=1.old')
  })
})

// —— fetchWithRetry 重试策略（P1-2 回归）——
describe('fetchWithRetry 重试策略', () => {
  const realFetch = globalThis.fetch
  afterEach(() => { globalThis.fetch = realFetch })

  it('4xx 不重试：一次请求后原样返回，交调用方识别错误体', async () => {
    const { fetchWithRetry } = await import('./utils')
    let calls = 0
    globalThis.fetch = vi.fn(async () => {
      calls++
      return { ok: false, status: 401, json: async () => ({ error: '登录已过期' }) }
    })
    const res = await fetchWithRetry('/x', {}, 3, 1)
    expect(calls).toBe(1)
    expect(res.status).toBe(401)
  })

  it('5xx 会重试，最多 maxAttempts 次，最终把响应交给调用方', async () => {
    const { fetchWithRetry } = await import('./utils')
    let calls = 0
    globalThis.fetch = vi.fn(async () => { calls++; return { ok: false, status: 503 } })
    const res = await fetchWithRetry('/x', {}, 3, 1)
    expect(calls).toBe(3)
    expect(res.status).toBe(503)
  })

  it('429 也重试；重试后成功则返回 2xx', async () => {
    const { fetchWithRetry } = await import('./utils')
    let calls = 0
    globalThis.fetch = vi.fn(async () => {
      calls++
      return calls === 1 ? { ok: false, status: 429 } : { ok: true, status: 200 }
    })
    const res = await fetchWithRetry('/x', {}, 3, 1)
    expect(calls).toBe(2)
    expect(res.status).toBe(200)
  })
})
