import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
    globalThis.window = { __QBAO_RUNTIME__: { apiBase: 'http://114.55.210.82:9178/api/v1', isDesktop: true } }
    const resolveMediaUrl = await freshResolve()
    expect(resolveMediaUrl('avatars/2.jpg')).toBe('http://114.55.210.82:9178/avatars/2.jpg')
    expect(resolveMediaUrl('/uploads/avatars/2.jpg')).toBe('http://114.55.210.82:9178/uploads/avatars/2.jpg')
  })

  it('空值/未知相对路径兜底', async () => {
    const resolveMediaUrl = await freshResolve()
    expect(resolveMediaUrl('')).toBe('')
    expect(resolveMediaUrl(null)).toBe('')
    expect(resolveMediaUrl('other/path')).toBe('other/path')
  })
})