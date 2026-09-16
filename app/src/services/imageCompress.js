// ============================================================
// imageCompress.js — 聊天图片上传前的本地压缩（v3.37.5）
//
// 背景（真实事故）：手机相册原图动辄 3~8MB，此前**原样上传**。在上行带宽
// 只有几百 KB/s 的网络里，一张图要传几十秒（实测 1.8MB 图上传 5~11s，用户
// 体感「极慢」），发出后对方再从服务器整包拉回来，聊天打开更慢。
//
// 策略（保守，宁可不压也不压坏）：
//   - 只处理位图（image/*），GIF 一律跳过（压了会丢动画），未知类型跳过；
//   - 小于阈值（默认 400KB）跳过，避免无意义的重编码损失；
//   - 最长边超过上限（默认 1600px）才等比缩放；极端长宽比（长截图）改保短边，
//     避免 1080x12000 被压成 144px 宽而看不清字；
//   - 优先输出 image/webp（同画质体积约为 jpeg 的 60~70%），
//     浏览器不支持时回退 image/jpeg；
//   - 含透明通道的图先铺白底（jpeg 无 alpha，否则透明区会变黑）；
//   - 压缩结果**不小于原件时放弃压缩**，返回原文件（绝不把图压大/压糊）。
//
// 纯逻辑（目标体积/尺寸/类型选择）拆成可单测的纯函数，DOM 部分薄封装。
// ============================================================

export const DEFAULT_MAX_EDGE = 1600
export const DEFAULT_QUALITY = 0.82
// 小于此体积直接原样上传：重编码收益低于画质损失
export const SKIP_BELOW_BYTES = 400 * 1024
// 压缩后仍大于此体积才算「值得压缩」，否则同样保留原件
export const GAIN_THRESHOLD = 0.9
// 不需要解码就能确定「压了会坏事」的类型
export const NEVER_COMPRESS_TYPES = ['image/gif']
// 短边下限：只按「最长边 ≤1600」缩放，会把长截图压成 144px 宽（实测 1080x12000
// 的聊天记录长截图会变成 144x1600）——那样的字根本看不清，等于把图压坏了。
// 极端长宽比时改为保短边，宁可体积大一些也不能让人看不清内容。
export const MIN_SHORT_EDGE = 400

// 缩放到最长边不超过 maxEdge 的目标尺寸；不放大（放大只会更糊更占体积）。
export function scaledSize(width, height, maxEdge, maxPixels) {
  const w = Number(width) || 0
  const h = Number(height) || 0
  if (w <= 0 || h <= 0) return { width: 0, height: 0, scale: 1 }
  const edge = Number(maxEdge) > 0 ? Number(maxEdge) : DEFAULT_MAX_EDGE
  const shortEdge = Math.min(w, h)
  let scale = Math.min(1, edge / Math.max(w, h))
  // 极端长宽比（长截图/全景）兜底：保短边可读，允许长边超出 maxEdge。
  // 正常照片/截图不会触发（它们的短边本身就远大于下限）。
  const floor = Number(MIN_SHORT_EDGE) > 0 ? Number(MIN_SHORT_EDGE) : 0
  if (floor > 0 && shortEdge * scale < floor) {
    scale = Math.min(1, floor / shortEdge)
  }
  // 超高像素图再按总像素兜一层，防止 canvas 内存爆炸（显式传入时优先）
  const cap = Number(maxPixels) > 0 ? Number(maxPixels) : 0
  if (cap > 0 && w * h * scale * scale > cap) {
    scale = Math.sqrt(cap / (w * h))
  }
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
    scale,
  }
}

// 是否需要压缩：类型、体积、尺寸三个门槛都不满足才跳过。
export function shouldCompress({ type, size, width, height }, opts) {
  const o = opts || {}
  const maxEdge = Number(o.maxEdge) > 0 ? Number(o.maxEdge) : DEFAULT_MAX_EDGE
  const skipBelow = Number(o.skipBelowBytes) > 0 ? Number(o.skipBelowBytes) : SKIP_BELOW_BYTES
  const t = String(type || '')
  if (t.indexOf('image/') !== 0) return false
  if (NEVER_COMPRESS_TYPES.indexOf(t) !== -1) return false
  if (Number(size) > 0 && Number(size) < skipBelow) return false
  const w = Number(width) || 0
  const h = Number(height) || 0
  // 没有尺寸信息时按「体积大就压」处理，交给上游先解码
  if (w > 0 && h > 0 && Math.max(w, h) <= maxEdge && Number(size) < skipBelow * 2) return false
  return true
}

// 选择输出格式：优先 webp（体积小），不支持则 jpeg。
export function pickOutputType(supported) {
  const list = Array.isArray(supported) ? supported : []
  if (list.indexOf('image/webp') !== -1) return 'image/webp'
  if (list.indexOf('image/jpeg') !== -1) return 'image/jpeg'
  return ''
}

// 输出文件名：换扩展名，避免 .png 里装 jpeg 触怒服务端 magic bytes 校验。
export function outputName(name, type) {
  const base = String(name || 'image').replace(/\.[^./\\]*$/, '')
  const ext = type === 'image/webp' ? '.webp' : '.jpg'
  return base + ext
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob !== 'function') return resolve(null)
    canvas.toBlob((b) => resolve(b), type, quality)
  })
}

// 探测浏览器支持的输出格式（一次，缓存结果）。
let cachedSupported = null
export function detectSupportedTypes(doc) {
  if (cachedSupported) return cachedSupported
  const d = doc || (typeof document !== 'undefined' ? document : null)
  const found = []
  if (!d || typeof d.createElement !== 'function') return found
  try {
    const c = d.createElement('canvas')
    if (c && typeof c.toDataURL === 'function') {
      if (c.toDataURL('image/webp').indexOf('data:image/webp') === 0) found.push('image/webp')
      if (c.toDataURL('image/jpeg').indexOf('data:image/jpeg') === 0) found.push('image/jpeg')
    }
  } catch { /* 探测失败按「无可用格式」处理 */ }
  cachedSupported = found
  return found
}

// 是否含透明像素（决定要不要铺白底）。getImageData 在部分环境会抛，失败按 false。
function hasAlpha(ctx, width, height) {
  try {
    const data = ctx.getImageData(0, 0, width, height).data
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 250) return true
    }
  } catch { /* 读像素失败按「不透明」处理 */ }
  return false
}

// 主入口：返回 { file, originalSize, size, compressed, width, height }。
// 任何环节失败都**回退原文件**，绝不阻断发送。
export async function compressImage(file, opts) {
  const o = opts || {}
  const originalSize = (file && file.size) || 0
  const passthrough = { file, originalSize, size: originalSize, compressed: false, width: 0, height: 0 }
  if (!file) return passthrough
  const type = file.type || ''
  if (type.indexOf('image/') !== 0 || NEVER_COMPRESS_TYPES.indexOf(type) !== -1) return passthrough
  if (originalSize > 0 && originalSize < (Number(o.skipBelowBytes) > 0 ? Number(o.skipBelowBytes) : SKIP_BELOW_BYTES)) {
    return passthrough
  }
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') {
    if (!shouldCompress({ type, size: originalSize }, o)) return passthrough
  }

  const maxEdge = Number(o.maxEdge) > 0 ? Number(o.maxEdge) : DEFAULT_MAX_EDGE
  const quality = Number(o.quality) > 0 ? Number(o.quality) : DEFAULT_QUALITY
  const outType = o.outputType || pickOutputType(detectSupportedTypes())
  if (!outType) return passthrough

  let bitmap = null
  let canvas = null
  try {
    // createImageBitmap 会按 EXIF 方向自动摆正（手机竖拍照片关键）
    bitmap = await createImageBitmap(file)
    const w = bitmap.width || 0
    const h = bitmap.height || 0
    if (!shouldCompress({ type, size: originalSize, width: w, height: h }, o)) {
      if (bitmap.close) bitmap.close()
      return Object.assign({}, passthrough, { width: w, height: h })
    }
    const target = scaledSize(w, h, maxEdge, o.maxPixels)
    canvas = document.createElement('canvas')
    canvas.width = target.width
    canvas.height = target.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d context unavailable')
    // jpeg 无透明通道：含透明像素时铺白底，避免透明区域变黑
    if (outType === 'image/jpeg' && hasAlpha(ctx, w, h)) {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, target.width, target.height)
    }
    ctx.drawImage(bitmap, 0, 0, target.width, target.height)
    const blob = await canvasToBlob(canvas, outType, quality)
    if (!blob || blob.size <= 0) throw new Error('encode failed')
    // 压不小就放弃（例如本来就是高压缩比的小图被重编码变大）
    if (blob.size >= originalSize * (Number(o.gainThreshold) > 0 ? Number(o.gainThreshold) : GAIN_THRESHOLD)) {
      if (bitmap.close) bitmap.close()
      return Object.assign({}, passthrough, { width: w, height: h })
    }
    const name = outputName(file.name, outType)
    const out = typeof File === 'function'
      ? new File([blob], name, { type: outType, lastModified: Date.now() })
      : blob
    if (bitmap.close) bitmap.close()
    return { file: out, originalSize, size: blob.size, compressed: true, width: target.width, height: target.height }
  } catch {
    // 任何解码/编码失败都不阻断发送：原样上传原件
    if (bitmap && bitmap.close) {
      try { bitmap.close() } catch { /* ignore */ }
    }
    return passthrough
  } finally {
    // 显式断开 canvas 引用，尽早回收大图内存
    if (canvas) { canvas.width = 0; canvas.height = 0 }
  }
}
