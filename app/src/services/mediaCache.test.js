import { describe, it, expect, beforeEach } from 'vitest'
import {
  mediaKey,
  cachedUrl,
  ensureLoaded,
  putMedia,
  warmMedia,
  seedMedia,
  clearMediaCache,
  withMediaWidth,
  cachedOrOriginal,
  _resetForTest,
} from './mediaCache'

// v3.37.6：渲染取址是「图片能不能显示」的最后一环，拼错一个字符就是全站裂图，
// 所以这两个纯函数单独锁死（组件里的 mediaSrc 只是它们的组合）。
describe('渲染取址', () => {
  it('无查询串时用 ? 拼接，有查询串时用 & 拼接', () => {
    expect(withMediaWidth('/api/v1/chat/files/x.png', 480)).toBe('/api/v1/chat/files/x.png?w=480')
    expect(withMediaWidth('/api/v1/chat/files/x.png?t=1.a', 480)).toBe('/api/v1/chat/files/x.png?t=1.a&w=480')
  })

  it('幂等：已有 w= 的地址不再追加（否则会变成 w=480&w=480）', () => {
    const u = '/api/v1/chat/files/x.png?t=1.a&w=320'
    expect(withMediaWidth(u, 480)).toBe(u)
  })

  it('blob:/data:/空值/非法宽度一律原样返回', () => {
    expect(withMediaWidth('blob:http://x/abc', 480)).toBe('blob:http://x/abc')
    expect(withMediaWidth('data:image/png;base64,AA', 480)).toBe('data:image/png;base64,AA')
    expect(withMediaWidth('', 480)).toBe('')
    expect(withMediaWidth(null, 480)).toBe(null)
    expect(withMediaWidth('/a.png', 0)).toBe('/a.png')
    expect(withMediaWidth('/a.png', 'x')).toBe('/a.png')
  })

  it('本地命中时整串替换成本地地址，且绝不在 blob: 地址上再拼参数', () => {
    const map = { 'x.png#w480': 'blob:http://x/one' }
    const thumb = '/api/v1/chat/files/x.png?t=1.a&w=480'
    expect(cachedOrOriginal(thumb, map)).toBe('blob:http://x/one')
    // 换票据后依然命中（键不含票据）
    expect(cachedOrOriginal('/api/v1/chat/files/x.png?t=9.z&w=480', map)).toBe('blob:http://x/one')
    // 原图没缓存 → 回退网络地址
    expect(cachedOrOriginal('/api/v1/chat/files/x.png?t=1.a', map)).toBe('/api/v1/chat/files/x.png?t=1.a')
    // 空/异常输入不抛
    expect(cachedOrOriginal('', map)).toBe('')
    expect(cachedOrOriginal('/a.png', null)).toBe('/a.png')
  })
})

describe('mediaCache 缓存键', () => {
  beforeEach(() => _resetForTest())

  it('同一张图换票据后仍是同一个键（这是缓存能命中的前提）', () => {
    const a = mediaKey('/api/v1/chat/files/chat_1_abc.png?t=1700000000000.sigA')
    const b = mediaKey('/api/v1/chat/files/chat_1_abc.png?t=1700009999999.sigB')
    expect(a).toBe(b)
    expect(a).toBe('chat_1_abc.png')
  })

  it('补全成绝对地址后键不变', () => {
    expect(mediaKey('https://beta.questionbox.cn/api/v1/chat/files/x.webp?t=1.a')).toBe('x.webp')
  })

  it('缩略图与原图是不同的键（否则列表会把小图当成原图）', () => {
    const full = mediaKey('/api/v1/chat/files/x.webp?t=1.a')
    const thumb = mediaKey('/api/v1/chat/files/x.webp?t=1.a&w=480')
    expect(full).toBe('x.webp')
    expect(thumb).toBe('x.webp#w480')
    expect(full).not.toBe(thumb)
  })

  it('非业务地址 / 空值不产生键', () => {
    expect(mediaKey('')).toBe('')
    expect(mediaKey(null)).toBe('')
    expect(mediaKey('blob:http://x/abc')).toBe('')
    expect(mediaKey('data:image/png;base64,AAA')).toBe('')
  })
})

describe('mediaCache 在无 IndexedDB 环境下必须安全降级', () => {
  beforeEach(() => _resetForTest())

  it('node 测试环境（无 indexedDB）下一切都静默返回，不抛异常', async () => {
    expect(typeof indexedDB).toBe('undefined')
    await expect(ensureLoaded(['/api/v1/chat/files/a.png?t=1.x'])).resolves.toEqual({})
    await expect(putMedia('/api/v1/chat/files/a.png?t=1.x', { size: 10 })).resolves.toBe('')
    await expect(warmMedia('/api/v1/chat/files/a.png?t=1.x')).resolves.toBe('')
    await expect(seedMedia('/api/v1/chat/files/a.png?t=1.x', { size: 10 })).resolves.toBe('')
    await expect(clearMediaCache()).resolves.toBeUndefined()
    expect(cachedUrl('/api/v1/chat/files/a.png?t=1.x')).toBe('')
  })

  it('cachedUrl 对空值/非媒体地址返回空串', () => {
    expect(cachedUrl('')).toBe('')
    expect(cachedUrl(null)).toBe('')
  })
})
