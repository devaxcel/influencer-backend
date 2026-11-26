import { seal, unseal } from '../src/services/secretBox'

describe('secretBox', () => {
  it('round-trips a key and never stores it in plain text', () => {
    const sealed = seal('tvly-abcdef-1234567890')
    expect(JSON.stringify(sealed)).not.toContain('tvly-abcdef')
    expect(unseal(sealed)).toBe('tvly-abcdef-1234567890')
  })

  it('uses a fresh iv every time', () => {
    expect(seal('same-secret-value').i).not.toBe(seal('same-secret-value').i)
  })

  it('returns null for tampered or missing data instead of throwing', () => {
    const sealed = seal('another-secret-value')
    expect(unseal({ ...sealed, c: Buffer.from('tampered').toString('base64') })).toBeNull()
    expect(unseal({ ...sealed, t: Buffer.alloc(16).toString('base64') })).toBeNull()
    expect(unseal(undefined)).toBeNull()
    expect(unseal({})).toBeNull()
  })
})
