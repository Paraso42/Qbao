import { describe, it, expect, vi } from 'vitest'
import { fetchDesktopRelease, formatSize, formatDate } from './desktopRelease'

describe('desktopRelease 网页端桌面版下载信息 (v3.34.1)', () => {
  it('fetchDesktopRelease 成功解析服务器元信息', async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, version: '3.34.1', fileName: 'Qbao-Setup-3.34.1.exe', sizeBytes: 104857600, sha256: 'abcd', publishedAt: '2026-09-04T15:01:20Z', downloadUrl: '/api/v1/desktop/download' }),
    }))
    const j = await fetchDesktopRelease(fetcher)
    expect(j.version).toBe('3.34.1')
    expect(fetcher).toHaveBeenCalledWith('/api/v1/desktop/latest', expect.objectContaining({ headers: { Accept: 'application/json' } }))
  })

  it('HTTP 非 200 → 抛出并提示后端接口', async () => {
    const fetcher = vi.fn(async () => ({ ok: false, status: 404 }))
    await expect(fetchDesktopRelease(fetcher)).rejects.toThrow(/404/)
  })

  it('载荷缺失关键字段 → 拒绝', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }))
    await expect(fetchDesktopRelease(fetcher)).rejects.toThrow(/无效/)
  })

  it('formatSize 单位换算', () => {
    expect(formatSize(0)).toBe('—')
    expect(formatSize(104857600)).toBe('100.0 MB')
    expect(formatSize(2147483648)).toBe('2.00 GB')
    expect(formatSize(512000)).toBe('500 KB')
  })

  it('formatDate 输出 YYYY-MM-DD，无效输入回退占位', () => {
    expect(formatDate('2026-09-04T15:01:20Z')).toBe('2026-09-04')
    expect(formatDate(null)).toBe('—')
    expect(formatDate('bad')).toBe('—')
  })
})
