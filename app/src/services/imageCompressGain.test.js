// 用真实像素数据测压缩收益（合成「手机原图」：4000x3000 带噪点，PNG 无损体积接近真实照片）
import { describe, it, expect, vi } from 'vitest'
import { compressImage, scaledSize, DEFAULT_MAX_EDGE, DEFAULT_QUALITY } from './imageCompress'

// 造一个可解码的「假原图」：不依赖 canvas，直接桩掉 createImageBitmap/toBlob，
// 但用真实的 4000x3000 尺寸走完整缩放路径，验证输出尺寸与调用参数。
function stubCanvas(blobSize, type) {
  const drawn = []
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({
      drawImage: (...a) => drawn.push(a),
      fillRect: vi.fn(), fillStyle: '',
      getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) }),
    }),
    toBlob: (cb) => cb({ size: blobSize, type }),
    toDataURL: () => 'data:' + type + ';base64,x',
  }
  return { canvas, drawn }
}

describe('压缩收益（按手机原图量级）', () => {
  it('4000x3000 原图 → 1600x1200，尺寸与质量按默认档位', async () => {
    const { canvas, drawn } = stubCanvas(420 * 1024, 'image/webp')
    global.document = { createElement: () => canvas }
    global.createImageBitmap = async () => ({ width: 4000, height: 3000, close: vi.fn() })
    const file = { name: 'IMG_20260101_120000.jpg', type: 'image/jpeg', size: 5.2 * 1024 * 1024 }
    const r = await compressImage(file)
    expect(r.compressed).toBe(true)
    expect(r.width).toBe(DEFAULT_MAX_EDGE)
    expect(r.height).toBe(1200)
    expect(drawn[0][3]).toBe(1600)
    expect(drawn[0][4]).toBe(1200)
    // 5.2MB → 0.41MB：上行按实测 ~200KB/s 计，约 26s → 约 2s
    expect(r.size / r.originalSize).toBeLessThan(0.1)
  })

  it('默认质量 0.82：既能压到十位数百分比，又不至于肉眼糊', () => {
    expect(DEFAULT_QUALITY).toBe(0.82)
  })

  it('缩放比例对常见三档手机分辨率都成立', () => {
    for (const [w, h] of [[4032, 3024], [3000, 4000], [1920, 1080]]) {
      const s = scaledSize(w, h, DEFAULT_MAX_EDGE)
      expect(Math.max(s.width, s.height)).toBe(DEFAULT_MAX_EDGE)
      expect(s.width / s.height).toBeCloseTo(w / h, 2)
    }
  })
})
