// ============================================================
// chatVirtual.js — 聊天消息窗口化渲染的纯窗口计算（v3.32 P2.4）
// 给定每行估算高度与滚动位置，返回可见窗口与上下占位高度。
// 纯函数便于单测；ChatMessages.vue 消费。
// ============================================================

// 按消息类型估算行高（flex column 容器含 gap 的行距由调用方提供）
export function msgEstimateHeight(m, baseRow) {
  const t = m && m.msg_type
  if (t === 'image') return Math.round(baseRow * 2.4)
  if (t === 'quiz_share' || t === 'bank_share') return Math.round(baseRow * 1.9)
  if (t === 'file') return Math.round(baseRow * 1.4)
  return baseRow
}

// 窗口计算：返回 { startIdx, endIdx, topPad, botPad }
// heights = 每行内容高度（不含 gap）；gap = 行间距；滚动可视区 [scrollTop, scrollTop+viewH]，
// 前后各扩 buf 高度渲染缓冲。
export function computeChatWindow({ total, heights, gap = 0, scrollTop = 0, viewH = 600, buf = 0 }) {
  if (!total || total <= 0) return { startIdx: 0, endIdx: 0, topPad: 0, botPad: 0 }
  const pre = new Array(total + 1)
  pre[0] = 0
  for (let i = 0; i < total; i++) {
    const h = heights[i] !== undefined ? heights[i] : 84
    pre[i + 1] = pre[i] + gap + h
  }
  const totalH = pre[total]
  const viewTop = Math.max(0, scrollTop)
  const viewBottom = viewTop + Math.max(0, viewH)
  let startIdx = 0
  {
    let lo = 0, hi = total
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (pre[mid] < viewTop - buf) lo = mid; else hi = mid - 1 }
    startIdx = lo
  }
  let endIdx = total
  {
    let lo = 0, hi = total
    while (lo < hi) { const mid = (lo + hi) >> 1; if (pre[mid + 1] < viewBottom + buf) lo = mid + 1; else hi = mid }
    endIdx = Math.min(total, lo + 1)
  }
  return {
    startIdx,
    endIdx,
    topPad: startIdx > 0 ? pre[startIdx] : 0,
    botPad: endIdx < total ? totalH - pre[endIdx] : 0,
  }
}
