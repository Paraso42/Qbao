// P1.3 api token 存取加固单测（web 混淆 / desktop safeStorage）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

function makeLocalStorageStub(seed = {}) {
  const map = new Map(Object.entries(seed))
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)) },
    removeItem: (k) => { map.delete(k) },
    _map: map,
  }
}

function makeSecretBridge() {
  const secrets = new Map()
  return {
    secretSave: vi.fn(async (name, value) => { secrets.set(name, value); return { ok: true } }),
    secretLoad: vi.fn(async (name) => (secrets.has(name) ? { ok: true, value: secrets.get(name) } : { ok: false, code: 'not_found' })),
    secretRemove: vi.fn(async (name) => { secrets.delete(name); return { ok: true } }),
    _secrets: secrets,
  }
}

describe('api token web 形态', () => {
  let storage
  let mod
  beforeEach(async () => {
    storage = makeLocalStorageStub()
    globalThis.localStorage = storage
    vi.resetModules()
    mod = await import('./api')
  })
  afterEach(() => { delete globalThis.localStorage })

  it('setToken 混淆落盘，getToken 还原', () => {
    mod.setToken('jwt-token-abc')
    const raw = storage.getItem('qbao_token')
    expect(raw.indexOf('jwt-token-abc')).toBe(-1)
    expect(raw).toContain('qb1:')
    expect(mod.getToken()).toBe('jwt-token-abc')
  })

  it('旧明文兼容：读旧 token 不破坏登录态', () => {
    storage.setItem('qbao_token', 'legacy-jwt-plain')
    expect(mod.getToken()).toBe('legacy-jwt-plain')
  })

  it('clearStoredAuth 清除 token 与用户', () => {
    mod.setToken('x')
    storage.setItem('qbao_user', JSON.stringify({ id: 'u1' }))
    mod.clearStoredAuth()
    expect(mod.getToken()).toBeNull()
    expect(storage.getItem('qbao_user')).toBeNull()
  })
})

describe('api token desktop 形态（safeStorage）', () => {
  let storage
  let bridge
  beforeEach(async () => {
    storage = makeLocalStorageStub()
    globalThis.localStorage = storage
    bridge = makeSecretBridge()
    globalThis.window = {
      __QBAO_RUNTIME__: { apiBase: 'https://x.example/api/v1', isDesktop: true },
      __qbaoDesktop: bridge,
    }
    vi.resetModules()
  })
  afterEach(() => { delete globalThis.localStorage; delete globalThis.window })

  it('登录写入：setToken 走 IPC 加密，renderer 无明文', async () => {
    const mod = await import('./api')
    mod.setToken('jwt-desktop-secret')
    expect(mod.getToken()).toBe('jwt-desktop-secret') // 内存读
    await new Promise((r) => setTimeout(r, 0))
    expect(bridge.secretSave).toHaveBeenCalledWith('token', 'jwt-desktop-secret')
    expect(storage.getItem('qbao_token')).toBeNull()
  })

  it('启动预热：initSecureAuth 从安全存储恢复 token（模拟新进程）', async () => {
    const mod = await import('./api')
    mod.setToken('jwt-persisted')
    await new Promise((r) => setTimeout(r, 0))
    // 模拟重启：内存清空
    vi.resetModules()
    const mod2 = await import('./api')
    expect(mod2.getToken()).toBeNull()
    await mod2.initSecureAuth()
    expect(mod2.getToken()).toBe('jwt-persisted')
    // localStorage 无明文
    expect(storage.getItem('qbao_token')).toBeNull()
  })

  it('升级迁移：旧明文 token 预热时转入安全存储并清明文', async () => {
    storage.setItem('qbao_token', 'old-plain-jwt')
    const mod = await import('./api')
    await mod.initSecureAuth()
    expect(mod.getToken()).toBe('old-plain-jwt')
    await new Promise((r) => setTimeout(r, 0))
    expect(bridge.secretSave).toHaveBeenCalledWith('token', 'old-plain-jwt')
    expect(storage.getItem('qbao_token')).toBeNull()
  })

  it('登出：setToken(null) 清理安全存储', async () => {
    const mod = await import('./api')
    mod.setToken('jwt')
    await new Promise((r) => setTimeout(r, 0))
    mod.setToken(null)
    await new Promise((r) => setTimeout(r, 0))
    expect(mod.getToken()).toBeNull()
    expect(bridge.secretRemove).toHaveBeenCalledWith('token')
  })
})
