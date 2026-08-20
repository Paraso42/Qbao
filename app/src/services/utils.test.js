import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { avatarCropSource } from './utils'
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