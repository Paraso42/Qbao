// 网页端「设置 → 桌面端」下载信息（v3.35 · manifest-first）
// 数据源：本站服务器 /api/v1/desktop/{manifest,latest,stats}（国内镜像，不跳转 GitHub）。
import { API_BASE } from '../core/env'

const jsonHeaders = { Accept: 'application/json' }

async function requestJson(fetcher, url, tag) {
  const f = fetcher || ((u, opts) => fetch(u, opts))
  const res = await f(url, { headers: jsonHeaders })
  if (!res || !res.ok) throw new Error(tag + ' HTTP ' + (res && res.status))
  const j = await res.json()
  if (!j || j.ok !== true) throw new Error(tag + ' 响应无效')
  return j
}

// 兼容旧接口：最新稳定版元信息（/latest）
export async function fetchDesktopRelease(fetcher) {
  const j = await requestJson(fetcher, API_BASE + '/desktop/latest', '下载信息')
  if (!j.fileName || !j.version) throw new Error('下载信息无效')
  return j
}

// 版本清单（manifest-first）：{ ok, channel, required, releases[] }
export async function fetchDesktopManifest(fetcher, channel) {
  const ch = channel || 'stable'
  const j = await requestJson(fetcher, API_BASE + '/desktop/manifest?channel=' + encodeURIComponent(ch), '版本清单')
  if (!Array.isArray(j.releases)) throw new Error('版本清单无效')
  return j
}

// 下载统计（可选能力：失败由调用方忽略）
export async function fetchDesktopStats(fetcher) {
  return requestJson(fetcher, API_BASE + '/desktop/stats', '下载统计')
}

// 清单 → 展示层结构（current/stopped/retracted 徽标所需字段）
export function parseReleases(j) {
  if (!j || !Array.isArray(j.releases)) return []
  return j.releases.map((r, i) => ({
    version: r.version,
    fileName: r.fileName,
    sizeBytes: r.sizeBytes,
    sizeText: formatSize(r.sizeBytes),
    sha256: r.sha256,
    dateText: formatDate(r.releaseDate),
    releaseNotes: Array.isArray(r.releaseNotes) ? r.releaseNotes : [],
    required: r.required || null,
    retracted: r.retracted && r.retracted.reason ? r.retracted.reason : null,
    stopped: !!r.stopped,
    current: i === 0,
  }))
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

export function formatDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (x) => String(x).padStart(2, '0')
  return formatDate(iso) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
}
