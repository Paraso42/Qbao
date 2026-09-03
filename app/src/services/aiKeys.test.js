// P1.3 aiKeys 双形态单测：
//  - web：localStorage 混淆读写 + 旧明文兼容迁移
//  - desktop：safeStorage IPC（mock desktopBridge）+ renderer 无明文 + 账号隔离
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
    secretAvailable: vi.fn(async () => true),
    secretSave: vi.fn(async (name, value) => { secrets.set(name, value); return { ok: true } }),
    secretLoad: vi.fn(async (name) => (secrets.has(name) ? { ok: true, value: secrets.get(name) } : { ok: false, code: 'not_found' })),
    secretRemove: vi.fn(async (name) => { secrets.delete(name); return { ok: true } }),
    _secrets: secrets,
  }
}

describe('aiKeys web 形态（IS_DESKTOP=false）', () => {
  let storage
  let mod
  beforeEach(async () => {
    storage = makeLocalStorageStub()
    globalThis.localStorage = storage
    vi.resetModules()
    mod = await import('./aiKeys')
  })
  afterEach(() => { delete globalThis.localStorage })

  it('set/get/remove 经混淆落盘，localStorage 不含明文', () => {
    mod.setAiApiKey('ecnu', 'sk-web-key-123')
    expect(mod.getAiApiKey('ecnu')).toBe('sk-web-key-123')
    const raw = storage.getItem('qbao_ai_keys_v1')
    expect(raw.indexOf('sk-web-key-123')).toBe(-1)
    expect(raw).toContain('qb1:')
    expect(mod.hasAiApiKey('ecnu')).toBe(true)
    mod.removeAiApiKey('ecnu')
    expect(mod.getAiApiKey('ecnu')).toBe('')
    expect(mod.hasAnyAiApiKey()).toBe(false)
  })

  it('账号隔离：登录后读写账号专属键', () => {
    storage.setItem('qbao_user', JSON.stringify({ id: 'u9' }))
    mod.setAiApiKey('deepseek', 'sk-u9')
    expect(storage.getItem('qbao_ai_keys_v1_u_u9')).toBeTruthy()
    expect(storage.getItem('qbao_ai_keys_v1')).toBeNull()
    expect(mod.getAiApiKey('deepseek')).toBe('sk-u9')
  })

  it('旧明文存储兼容：读取时透明升级读取，不误判为空', () => {
    storage.setItem('qbao_ai_keys_v1', JSON.stringify({ ecnu: 'sk-legacy-plain' }))
    expect(mod.getAiApiKey('ecnu')).toBe('sk-legacy-plain')
    expect(mod.hasAnyAiApiKey()).toBe(true)
  })

  it('migrateLegacyAiKeysFromState：从 state.aiConfig 迁出后 state 无密钥', () => {
    const s = { aiConfig: { provider: 'ecnu', apiKey: 'sk-in-state', providerKeys: { gemini: 'sk-g' } } }
    const n = mod.migrateLegacyAiKeysFromState(s)
    expect(n).toBe(2)
    expect(s.aiConfig.apiKey).toBeUndefined()
    expect(s.aiConfig.providerKeys).toBeUndefined()
    expect(mod.getAiApiKey('ecnu')).toBe('sk-in-state')
    expect(mod.getAiApiKey('gemini')).toBe('sk-g')
  })
})

describe('aiKeys desktop 形态（safeStorage IPC）', () => {
  let storage
  let bridge
  beforeEach(async () => {
    storage = makeLocalStorageStub()
    globalThis.localStorage = storage
    bridge = makeSecretBridge()
    // 模拟 preload 注入的运行时
    globalThis.window = {
      __QBAO_RUNTIME__: { apiBase: 'https://x.example/api/v1', isDesktop: true },
      __qbaoDesktop: bridge,
    }
    vi.resetModules()
  })
  afterEach(() => {
    delete globalThis.localStorage
    delete globalThis.window
  })

  async function importKeys() { return import('./aiKeys') }

  it('预热：旧 localStorage 明文迁移进安全存储并清除本地明文', async () => {
    storage.setItem('qbao_user', JSON.stringify({ id: 'u1' }))
    storage.setItem('qbao_ai_keys_v1_u_u1', JSON.stringify({ ecnu: 'sk-migrate' }))
    const mod = await importKeys()
    const ok = await mod.initSecureKeyStore()
    expect(ok).toBe(true)
    expect(bridge.secretSave).toHaveBeenCalled()
    const savedName = bridge.secretSave.mock.calls[0][0]
    expect(savedName).toBe('aikeys_u_u1')
    // renderer 无明文残留
    expect(storage.getItem('qbao_ai_keys_v1_u_u1')).toBeNull()
    expect(mod.getAiApiKey('ecnu')).toBe('sk-migrate')
  })

  it('保存：setAiApiKey 走 IPC 加密，localStorage 不落盘', async () => {
    storage.setItem('qbao_user', JSON.stringify({ id: 'u1' }))
    const mod = await importKeys()
    await mod.initSecureKeyStore()
    mod.setAiApiKey('deepseek', 'sk-desk-secret')
    await new Promise((r) => setTimeout(r, 0))
    expect(mod.getAiApiKey('deepseek')).toBe('sk-desk-secret')
    expect(bridge.secretSave).toHaveBeenCalledWith('aikeys_u_u1', expect.stringContaining('sk-desk-secret'))
    // localStorage 无任何明文键
    const keys = [...storage._map.keys()].filter((k) => k.indexOf('qbao_ai_keys') === 0)
    expect(keys).toEqual([])
    // 新进程（内存清空）：从安全存储能恢复
    vi.resetModules()
    const mod2 = await import('./aiKeys')
    await mod2.initSecureKeyStore()
    expect(mod2.getAiApiKey('deepseek')).toBe('sk-desk-secret')
  })

  it('账号隔离：u1/u2 的密钥存储名不同、互不可见', async () => {
    storage.setItem('qbao_user', JSON.stringify({ id: 'u1' }))
    const mod = await importKeys()
    await mod.initSecureKeyStore()
    mod.setAiApiKey('ecnu', 'key-of-u1')
    await new Promise((r) => setTimeout(r, 0))
    // 切到 u2
    storage.setItem('qbao_user', JSON.stringify({ id: 'u2' }))
    expect(mod.getAiApiKey('ecnu')).toBe('') // 未预热且无 legacy → 空（不串 u1）
    const names = [...bridge._secrets.keys()]
    expect(names).toEqual(['aikeys_u_u1'])
  })

  it('safeStorage 不可用：降级混淆写 localStorage，功能不中断', async () => {
    storage.setItem('qbao_user', JSON.stringify({ id: 'u1' }))
    bridge.secretAvailable.mockResolvedValueOnce(false)
    bridge.secretSave.mockImplementation(async () => ({ ok: false, error: 'safeStorage 不可用' }))
    const mod = await importKeys()
    await mod.initSecureKeyStore()
    mod.setAiApiKey('ecnu', 'sk-fallback')
    await new Promise((r) => setTimeout(r, 0))
    expect(mod.getAiApiKey('ecnu')).toBe('sk-fallback')
    const raw = storage.getItem('qbao_ai_keys_v1_u_u1')
    expect(raw).toBeTruthy()
    expect(raw.indexOf('sk-fallback')).toBe(-1) // 降级也是混淆存储
  })
})
