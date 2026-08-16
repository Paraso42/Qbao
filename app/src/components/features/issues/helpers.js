// ============================================================
// helpers.js — Issue 组件共享工具（自 legacy feedback.js 迁移）
// fbFormatTime / fbStatusLabel / fbStatusHint / 状态样式映射
// ============================================================

// 状态 → 文案（同 fbStatusLabel）
export function statusLabel(status) {
  const map = { unread: '未读', read: '已读', resolved: '处理完毕', closed: '已关闭' }
  return map[status] || status
}

// 状态 → 提示文案（同 fbStatusHint）
export function statusHint(status, isAdmin) {
  if (isAdmin) {
    if (status === 'unread') return '点击"标记为已读"通知用户'
    if (status === 'read') return '修复完成后点击"标记为处理完毕"'
    if (status === 'resolved') return '等待用户验证修复结果'
    if (status === 'closed') return '此 Issue 已关闭'
  } else {
    if (status === 'unread') return '等待管理员处理中...'
    if (status === 'read') return '管理员正在处理中...'
    if (status === 'resolved') return '请验证修复结果'
    if (status === 'closed') return '此 Issue 已关闭'
  }
  return ''
}

// 状态 pill 复用 components.css 语义类：unread 红 / read 蓝 / resolved 绿 / closed 灰
export function statusPillClass(status) {
  const map = { unread: 'pill-fail', read: 'pill-run', resolved: 'pill-ok', closed: 'pill-muted' }
  return map[status] || 'pill-muted'
}

// 状态圆点颜色（数据驱动，使用 design token）
export function statusColor(status) {
  const map = {
    unread: 'var(--color-danger)',
    read: 'var(--color-info)',
    resolved: 'var(--color-success)',
    closed: 'var(--status-muted)'
  }
  return map[status] || 'var(--status-muted)'
}

// 相对时间（同 fbFormatTime）
export function formatIssueTime(isoStr) {
  if (!isoStr) return ''
  try {
    const d = new Date(isoStr)
    const now = new Date()
    const diffMs = now - d
    if (diffMs < 60000) return '刚刚'
    if (diffMs < 3600000) return Math.floor(diffMs / 60000) + '分钟前'
    if (diffMs < 86400000) return Math.floor(diffMs / 3600000) + '小时前'
    if (diffMs < 604800000) return Math.floor(diffMs / 86400000) + '天前'
    return (d.getMonth() + 1) + '/' + d.getDate()
  } catch (e) { return '' }
}
