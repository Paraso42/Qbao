// P1.3 混淆原语单测（web 最小混淆：往返/兼容/损坏处理）
import { describe, it, expect } from 'vitest'
import { obfuscate, deobfuscate, b64encode, b64decode, OBF_PREFIX } from './secureStore'

describe('secureStore 混淆原语 (P1.3)', () => {
  it('obfuscate/deobfuscate 往返一致，中文与符号安全', () => {
    const samples = ['sk-abc123', 'eyJhbGciOiJIUzI1NiJ9.xxxx.yyyy', '含中文密钥：机密!!', 'a']
    samples.forEach((s) => {
      const enc = obfuscate(s)
      expect(enc).not.toBe(s)
      expect(enc.indexOf(s)).toBe(-1) // 输出不含明文子串
      expect(deobfuscate(enc)).toBe(s)
    })
  })

  it('混淆值带前缀且可被识别，非 base64 字符不出现明文', () => {
    const enc = obfuscate('sk-TOP-SECRET-123')
    expect(enc.indexOf(OBF_PREFIX)).toBe(0)
    expect(enc).not.toMatch(/sk-TOP-SECRET/)
  })

  it('旧明文兼容：无前缀按原值返回（不破坏旧数据）', () => {
    expect(deobfuscate('sk-legacy-plain')).toBe('sk-legacy-plain')
    expect(deobfuscate(null)).toBeNull()
    expect(deobfuscate('')).toBe('')
  })

  it('前缀损坏（乱码/截断）返回 null 而非抛错', () => {
    expect(deobfuscate(OBF_PREFIX + '!!!not-base64!!!')).toBeNull()
    expect(deobfuscate(OBF_PREFIX + 'YQ')).not.toBeNull() // 合法 base64 截断可解则解
    expect(deobfuscate(OBF_PREFIX)).toBeNull()
  })

  it('b64 自实现与 UTF-8 字符串兼容（无 btoa 依赖）', () => {
    expect(b64decode(b64encode('hello'))).toBe('hello')
    expect(b64encode('A')).toBe('QQ==')
    expect(b64encode('AB')).toBe('QUI=')
    expect(b64encode('ABC')).toBe('QUJD')
  })
})
