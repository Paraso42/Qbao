// v3.37.5：聊天上传改走 XHR 只为拿到上传进度（fetch 无法报告上传进度，
// 图片原图数 MB 时界面会「一动不动」）。这里用假 XHR 锁住行为契约：
// 进度回调、成功解析、错误文案复用、401 清登出、网络中断、以及无 XHR 时的 fetch 回退。
//
// 说明：本仓库 vitest 跑在 node 环境（见 vite.config.js），Node 24 自带 File/FormData/Blob，
// 只缺 localStorage —— 用最小桩补上，不为此新增 jsdom 依赖。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../core/env', () => ({ API_BASE: 'https://api.test/api/v1', IS_DESKTOP: false, desktopBridge: () => null }))

const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
}

const { uploadFile } = await import('./chatApi')
const { setToken } = await import('./api')

const calls = []
class FakeXHR {
  constructor() {
    this.upload = {}
    this.status = 0
    this.responseText = ''
    this.headers = {}
    calls.push(this)
    FakeXHR.last = this
  }
  open(method, url) { this.method = method; this.url = url }
  setRequestHeader(k, v) { this.headers[k] = v }
  send(body) { this.body = body }
  emitProgress(loaded, total) { this.upload.onprogress({ lengthComputable: true, loaded, total }) }
  finish(status, text) { this.status = status; this.responseText = text; this.onload() }
  fail() { this.onerror() }
}
FakeXHR.last = null

const bigFile = () => new File([new Uint8Array(2048)], 'IMG_0001.PNG', { type: 'image/png' })

describe('uploadFile（XHR 进度版）', () => {
  beforeEach(() => {
    calls.length = 0
    FakeXHR.last = null
    globalThis.XMLHttpRequest = FakeXHR
    setToken('tok-123') // 走真实的令牌读取路径（含混淆存储/活读）
  })
  afterEach(() => { vi.restoreAllMocks(); delete globalThis.XMLHttpRequest; setToken(null) })

  it('POST 到 /chat/upload，FormData 字段名为 file，并带上 Bearer', async () => {
    const p = uploadFile(bigFile())
    const x = FakeXHR.last
    expect(x.method).toBe('POST')
    expect(x.url).toBe('https://api.test/api/v1/chat/upload')
    expect(x.headers['Authorization']).toMatch(/^Bearer /)
    expect(x.body instanceof FormData).toBe(true)
    expect(x.body.get('file')).toBeInstanceOf(File)
    x.finish(200, JSON.stringify({ url: '/api/v1/chat/files/a.png', name: 'a.png', size: 12 }))
    await expect(p).resolves.toMatchObject({ name: 'a.png' })
  })

  it('v3.37.6：带 thumb 时作为第二个字段同一次请求上传（列表小图）', async () => {
    const thumb = new File([new Uint8Array(64)], 'thumb.webp', { type: 'image/webp' })
    const p = uploadFile(bigFile(), { thumb })
    const x = FakeXHR.last
    expect(x.body.get('file')).toBeInstanceOf(File)
    expect(x.body.get('thumb')).toBeInstanceOf(File)
    // 只发一次请求：小图不额外起一次上传
    expect(calls.length).toBe(1)
    x.finish(200, JSON.stringify({ url: '/api/v1/chat/files/a.png' }))
    await p
  })

  it('不带 thumb 时不多发字段（老行为不变）', async () => {
    const p = uploadFile(bigFile())
    expect(FakeXHR.last.body.get('thumb')).toBe(null)
    FakeXHR.last.finish(200, '{}')
    await p
  })

  it('进度被换算成 0~100 的整数并回调，且不会超过 100', async () => {
    const seen = []
    const p = uploadFile(bigFile(), { onProgress: (v) => seen.push(v) })
    const x = FakeXHR.last
    x.emitProgress(0, 200)
    x.emitProgress(50, 200)
    x.emitProgress(199, 200)
    x.emitProgress(200, 200)
    x.finish(200, '{}')
    await p
    expect(seen).toEqual([0, 25, 100, 100])
  })

  it('长度不可知时回调 -1（界面据此不显示百分比）', async () => {
    const seen = []
    const p = uploadFile(bigFile(), { onProgress: (v) => seen.push(v) })
    FakeXHR.last.upload.onprogress({ lengthComputable: false, loaded: 1, total: 0 })
    FakeXHR.last.finish(200, '{}')
    await p
    expect(seen).toEqual([-1])
  })

  it('非 2xx 复用统一错误文案提取（后端 error 字段优先）', async () => {
    const p = uploadFile(bigFile())
    FakeXHR.last.finish(422, JSON.stringify({ error: '文件类型不支持' }))
    await expect(p).rejects.toThrow('文件类型不支持')
  })

  it('401 清掉本页登录态（与 fetchWithAuth 语义一致）', async () => {
    const p = uploadFile(bigFile())
    FakeXHR.last.finish(401, JSON.stringify({ error: '登录已过期' }))
    await expect(p).rejects.toThrow('登录已过期，请重新登录')
    expect(localStorage.getItem('qbao_token')).toBe(null)
  })

  it('网络中断给出可读文案，而不是卡住不返回', async () => {
    const p = uploadFile(bigFile())
    FakeXHR.last.fail()
    await expect(p).rejects.toThrow('网络中断，上传失败')
  })

  it('没有 XMLHttpRequest 的环境回退 fetch，功能不缺失', async () => {
    delete globalThis.XMLHttpRequest
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ url: '/x.png' }) }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(uploadFile(bigFile())).resolves.toMatchObject({ url: '/x.png' })
    expect(fetchMock).toHaveBeenCalled()
  })
})
