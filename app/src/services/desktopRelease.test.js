import { describe, it, expect, vi } from 'vitest'
import {
  fetchDesktopRelease,
  fetchDesktopManifest,
  fetchDesktopStats,
  parseReleases,
  formatSize,
  formatDate,
  formatDateTime,
} from './desktopRelease'

describe('desktopRelease 网页端桌面版下载信息 (v3.35 manifest-first)', () => {
  it('fetchDesktopRelease 兼容旧接口（/latest）', async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, version: '3.35.0', fileName: 'Qbao-Setup-3.35.0.exe', sizeBytes: 104857600, sha256: 'abcd', publishedAt: '2026-09-04T15:01:20Z', downloadUrl: '/api/v1/desktop/download' }),
    }))
    const j = await fetchDesktopRelease(fetcher)
    expect(j.version).toBe('3.35.0')
    expect(fetcher).toHaveBeenCalledWith('/api/v1/desktop/latest', expect.objectContaining({ headers: { Accept: 'application/json' } }))
  })

  it('fetchDesktopRelease HTTP 非 200 → 抛出', async () => {
    const fetcher = vi.fn(async () => ({ ok: false, status: 404 }))
    await expect(fetchDesktopRelease(fetcher)).rejects.toThrow(/404/)
  })

  it('fetchDesktopManifest 携带渠道参数并校验 releases 数组', async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, channel: 'beta', required: null, releases: [] }),
    }))
    const j = await fetchDesktopManifest(fetcher, 'beta')
    expect(j.channel).toBe('beta')
    expect(fetcher).toHaveBeenCalledWith('/api/v1/desktop/manifest?channel=beta', expect.anything())
    const bad = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, releases: 'nope' }) }))
    await expect(fetchDesktopManifest(bad)).rejects.toThrow(/无效/)
  })

  it('fetchDesktopStats 返回 perVersion', async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, perVersion: [{ version: '3.35.0', downloads: 3 }], last30d: [] }),
    }))
    const s = await fetchDesktopStats(fetcher)
    expect(s.perVersion[0].downloads).toBe(3)
  })

  it('parseReleases 映射展示层字段（current/stopped/retracted/sizeText）', () => {
    const list = parseReleases({
      releases: [
        { version: '3.36.0', fileName: 'Qbao-Setup-3.36.0.exe', sizeBytes: 204857600, sha256: 'a'.repeat(64), releaseDate: '2026-09-05T00:00:00Z', releaseNotes: ['修复若干问题'], required: '3.35.0', stopped: false, retracted: null },
        { version: '3.35.1', fileName: 'Qbao-Setup-3.35.1.exe', sizeBytes: 204857600, sha256: 'b'.repeat(64), releaseDate: '2026-09-04T00:00:00Z', releaseNotes: [], required: null, stopped: false, retracted: { reason: '恶性 bug', at: '2026-09-05T08:00:00Z' } },
        { version: '3.35.0', fileName: 'Qbao-Setup-3.35.0.exe', sizeBytes: 204857600, sha256: 'c'.repeat(64), releaseDate: '2026-09-03T00:00:00Z', releaseNotes: [], required: null, stopped: true, retracted: null },
      ],
    })
    expect(list.length).toBe(3)
    expect(list[0].current).toBe(true)
    expect(list[0].sizeText).toBe('195.4 MB')
    expect(list[0].required).toBe('3.35.0')
    expect(list[1].retracted).toBe('恶性 bug')
    expect(list[2].stopped).toBe(true)
    expect(list[2].current).toBe(false)
    expect(parseReleases(null)).toEqual([])
    expect(parseReleases({ releases: [] })).toEqual([])
  })

  it('formatSize 单位换算', () => {
    expect(formatSize(0)).toBe('—')
    expect(formatSize(104857600)).toBe('100.0 MB')
    expect(formatSize(2147483648)).toBe('2.00 GB')
    expect(formatSize(512000)).toBe('500 KB')
  })

  it('formatDate / formatDateTime 输出，无效输入回退占位', () => {
    expect(formatDate('2026-09-04T15:01:20Z')).toBe('2026-09-04')
    expect(formatDate(null)).toBe('—')
    expect(formatDate('bad')).toBe('—')
    // 用本地时间构造，保证任何时区下断言一致
    expect(formatDateTime(new Date(2026, 8, 4, 15, 1).toISOString())).toBe('2026-09-04 15:01')
    expect(formatDateTime(null)).toBe('—')
  })
})