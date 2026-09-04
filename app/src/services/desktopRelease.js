// 网页端「设置 → 桌面端」下载信息（v3.34.1）
// 国内镜像分发：数据来自本站服务器 /api/v1/desktop/latest（不跳转 GitHub）。
import { API_BASE } from '../core/env'

// fetcher 可注入（测试）；默认走全局 fetch
export async function fetchDesktopRelease(fetcher) {
  const f = fetcher || ((url, opts) => fetch(url, opts))
  const res = await f(API_BASE + '/desktop/latest', { headers: { Accept: 'application/json' } })
  if (!res || !res.ok) throw new Error('HTTP ' + (res && res.status))
  const j = await res.json()
  if (!j || j.ok !== true || !j.fileName || !j.version) throw new Error('下载信息无效')
  return j
}

export function formatSize(n) {
  const num = Number(n)
  if (!Number.isFinite(num) || num <= 0) return '—'
  if (num >= 1073741824) return (num / 1073741824).toFixed(2) + ' GB'
  if (num >= 1048576) return (num / 1048576).toFixed(1) + ' MB'
  if (num >= 1024) return Math.round(num / 1024) + ' KB'
  return num + ' B'
}

export function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (x) => String(x).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}
