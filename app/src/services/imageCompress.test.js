import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  scaledSize,
  shouldCompress,
  pickOutputType,
  outputName,
  compressImage,
  SKIP_BELOW_BYTES,
  DEFAULT_MAX_EDGE,
  MIN_SHORT_EDGE,
  DEFAULT_THUMB_EDGE,
  DEFAULT_THUMB_QUALITY,
} from './imageCompress'

// v3.37.5：聊天图片上传前压缩。真实事故 —— 手机原图数 MB 原样上传，
// 上行只有几百 KB/s 时一张图要几十秒，用户体感「图片发送极慢」。
// 这里锁住纯逻辑（缩放/门槛/格式）与「失败一律回退原文件」的安全网。

describe('scaledSize', () => {
  it('长边超限时等比缩小', () => {
    expect(scaledSize(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200, scale: 0.4 })
  })
  it('长边未超限时不放大（scale 保持 1）', () => {
    expect(scaledSize(800, 600, 1600)).toEqual({ width: 800, height: 600, scale: 1 })
  })
  it('竖图按高边缩放', () => {
    expect(scaledSize(1200, 4800, 1600)).toEqual({ width: 400, height: 1600, scale: 1 / 3 })
  })
  it('超长截图再受总像素上限约束（防 canvas 内存爆炸）', () => {
    const r = scaledSize(2000, 20000, 1600, 4 * 1000 * 1000)
    expect(r.width * r.height).toBeLessThanOrEqual(4 * 1000 * 1000 + 1)
    expect(r.scale).toBeLessThan(1)
  })
  it('尺寸非法时返回零尺寸而不是 NaN', () => {
    expect(scaledSize(0, 0, 1600)).toEqual({ width: 0, height: 0, scale: 1 })
    expect(scaledSize(NaN, 100, 1600)).toEqual({ width: 0, height: 0, scale: 1 })
  })
  // 真实数据抓出来的坑：1080x12000 的聊天记录长截图，只按「长边≤1600」会压成
  // 144px 宽 —— 字完全看不清，等于把图压坏了。极端长宽比改为保短边。
  it('极端长截图保短边可读，不压成一条细线', () => {
    const r = scaledSize(1080, 12000, 1600)
    expect(Math.min(r.width, r.height)).toBeGreaterThanOrEqual(400)
    expect(r.width).toBe(400)
    expect(r.height).toBe(4444)
  })
  it('长边超限的长截图仍然缩小（不是干脆不压）', () => {
    const r = scaledSize(1080, 12000, 1600)
    expect(r.scale).toBeLessThan(1)
    expect(r.width * r.height).toBeLessThan(1080 * 12000)
  })
  it('短边已经在可读范围时，仍按长边上限走（长截图规则不误伤普通图）', () => {
    expect(scaledSize(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600, scale: 1600 / 4032 })
    expect(scaledSize(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200, scale: 1600 / 4032 })
  })
})

describe('shouldCompress', () => {
  it('非图片一律不压', () => {
    expect(shouldCompress({ type: 'application/pdf', size: 9 * 1024 * 1024 })).toBe(false)
  })
  it('GIF 不压（压了丢动画）', () => {
    expect(shouldCompress({ type: 'image/gif', size: 5 * 1024 * 1024 })).toBe(false)
  })
  it('小图不压（重编码收益低于画质损失）', () => {
    expect(shouldCompress({ type: 'image/jpeg', size: SKIP_BELOW_BYTES - 1 })).toBe(false)
  })
  it('大且超尺寸的图要压', () => {
    expect(shouldCompress({ type: 'image/jpeg', size: 4 * 1024 * 1024, width: 4000, height: 3000 })).toBe(true)
  })
  it('大但已在尺寸内的图不压', () => {
    expect(shouldCompress({ type: 'image/png', size: 600 * 1024, width: 1200, height: 900 })).toBe(false)
  })
  it('尺寸未知但体积很大时仍要压（交给解码后判断）', () => {
    expect(shouldCompress({ type: 'image/jpeg', size: 3 * 1024 * 1024 })).toBe(true)
  })
})

describe('pickOutputType / outputName', () => {
  it('优先 webp', () => {
    expect(pickOutputType(['image/jpeg', 'image/webp'])).toBe('image/webp')
  })
  it('不支持 webp 时回退 jpeg', () => {
    expect(pickOutputType(['image/jpeg'])).toBe('image/jpeg')
  })
  it('都不支持时返回空串（调用方回退原文件）', () => {
    expect(pickOutputType([])).toBe('')
    expect(pickOutputType(null)).toBe('')
  })
  it('换扩展名：png 不能装 jpeg（否则服务端 magic bytes 校验会拒）', () => {
    expect(outputName('IMG_0001.PNG', 'image/jpeg')).toBe('IMG_0001.jpg')
    expect(outputName('a.b.c.png', 'image/webp')).toBe('a.b.c.webp')
    expect(outputName('', 'image/webp')).toBe('image.webp')
  })
})

describe('compressImage 安全网', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('非图片直接原样返回', async () => {
    const f = { name: 'a.pdf', type: 'application/pdf', size: 5 * 1024 * 1024 }
    const r = await compressImage(f)
    expect(r.compressed).toBe(false)
    expect(r.file).toBe(f)
    expect(r.size).toBe(f.size)
  })

  it('小于阈值的小图不触发解码（不发 createImageBitmap）', async () => {
    const spy = vi.fn()
    global.createImageBitmap = spy
    const f = { name: 's.png', type: 'image/png', size: 100 * 1024 }
    const r = await compressImage(f)
    expect(spy).not.toHaveBeenCalled()
    expect(r.compressed).toBe(false)
  })

  it('解码抛错时回退原文件，不阻断发送', async () => {
    global.createImageBitmap = vi.fn(async () => { throw new Error('decode boom') })
    global.document = { createElement: () => ({ getContext: () => null, toDataURL: () => 'data:image/webp;base64,x' }) }
    const f = { name: 'big.jpg', type: 'image/jpeg', size: 5 * 1024 * 1024 }
    const r = await compressImage(f)
    expect(r.compressed).toBe(false)
    expect(r.file).toBe(f)
  })

  it('压缩成功时返回更小的新文件与真实尺寸', async () => {
    const blob = { size: 200 * 1024, type: 'image/webp' }
    const ctx = { drawImage: vi.fn(), fillRect: vi.fn(), fillStyle: '', getImageData: () => ({ data: new Uint8ClampedArray(4) }) }
    const canvas = { width: 0, height: 0, getContext: () => ctx, toBlob: (cb, t) => cb(blob), toDataURL: () => 'data:image/webp;base64,x' }
    global.document = { createElement: () => canvas }
    global.createImageBitmap = vi.fn(async () => ({ width: 4000, height: 3000, close: vi.fn() }))
    global.File = class { constructor(parts, name, o) { this.parts = parts; this.name = name; this.type = o.type; this.size = parts[0].size } }
    const f = { name: 'IMG.png', type: 'image/png', size: 5 * 1024 * 1024 }
    const r = await compressImage(f)
    expect(r.compressed).toBe(true)
    expect(r.size).toBe(200 * 1024)
    expect(r.width).toBe(1600)
    expect(r.height).toBe(1200)
    expect(r.file.name).toBe('IMG.webp')
    expect(r.file.type).toBe('image/webp')
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 1200)
  })

  it('压完反而更大时保留原件（绝不把图压大）', async () => {
    const blob = { size: 4 * 1024 * 1024, type: 'image/webp' }
    const ctx = { drawImage: vi.fn(), fillRect: vi.fn(), fillStyle: '', getImageData: () => ({ data: new Uint8ClampedArray(4) }) }
    const canvas = { width: 0, height: 0, getContext: () => ctx, toBlob: (cb) => cb(blob), toDataURL: () => 'data:image/webp;base64,x' }
    global.document = { createElement: () => canvas }
    global.createImageBitmap = vi.fn(async () => ({ width: 4000, height: 3000, close: vi.fn() }))
    const f = { name: 'x.png', type: 'image/png', size: 3 * 1024 * 1024 }
    const r = await compressImage(f)
    expect(r.compressed).toBe(false)
    expect(r.file).toBe(f)
  })

  it('jpeg 输出遇到透明像素时先铺白底（否则透明区变黑）', async () => {
    const blob = { size: 100 * 1024, type: 'image/jpeg' }
    const data = new Uint8ClampedArray(4)
    data[3] = 10 // alpha < 250 → 判定含透明
    const ctx = { drawImage: vi.fn(), fillRect: vi.fn(), fillStyle: '', getImageData: () => ({ data }) }
    const canvas = { width: 0, height: 0, getContext: () => ctx, toBlob: (cb) => cb(blob), toDataURL: () => 'data:image/jpeg;base64,x' }
    global.document = { createElement: () => canvas }
    global.createImageBitmap = vi.fn(async () => ({ width: 2000, height: 2000, close: vi.fn() }))
    const f = { name: 'logo.png', type: 'image/png', size: 2 * 1024 * 1024 }
    const r = await compressImage(f, { outputType: 'image/jpeg' })
    expect(r.compressed).toBe(true)
    expect(ctx.fillRect).toHaveBeenCalled()
    expect(f.name).toBe('logo.png')
  })

  it('默认最大边为 1600（导出常量与实现一致）', () => {
    expect(DEFAULT_MAX_EDGE).toBe(1600)
  })
})

describe('列表缩略图尺寸（v3.37.6）', () => {
  it('普通照片：长边压到 480', () => {
    const s = scaledSize(4000, 3000, DEFAULT_THUMB_EDGE, 0, 0)
    expect(s.width).toBe(480)
    expect(s.height).toBe(360)
  })

  it('长截图：缩略图不套用短边下限，否则 400x4444 根本不叫缩略图', () => {
    const s = scaledSize(1080, 12000, DEFAULT_THUMB_EDGE, 0, 0)
    expect(s.width).toBe(43)
    expect(s.height).toBe(480)
    // 主图仍保短边可读（两者是不同策略，不能互相污染）
    const full = scaledSize(1080, 12000, DEFAULT_MAX_EDGE)
    expect(full.width).toBe(MIN_SHORT_EDGE)
  })

  it('缩略图不放大', () => {
    const s = scaledSize(120, 90, DEFAULT_THUMB_EDGE, 0, 0)
    expect(s.width).toBe(120)
    expect(s.height).toBe(90)
  })

  it('默认缩略图参数（长边 480 / 质量 0.62）', () => {
    expect(DEFAULT_THUMB_EDGE).toBe(480)
    expect(DEFAULT_THUMB_QUALITY).toBe(0.62)
  })
})
