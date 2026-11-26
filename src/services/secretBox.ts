import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { env } from '../config/env'

// Dashboard mein save hui API keys database mein AES-256-GCM se encrypt hoti hain.
// Encryption key: SETTINGS_ENCRYPTION_KEY (behtar), warna JWT refresh secret se banti hai.
// Key badalne par purani saved keys khul nahi paengi (dobara save karni hongi)

export interface Sealed {
  c: string // ciphertext (base64)
  i: string // iv (base64)
  t: string // auth tag (base64)
}

function key() {
  const base = (process.env.SETTINGS_ENCRYPTION_KEY || '').trim() || env.jwtRefreshSecret || env.jwtAccessSecret
  if (!base) throw new Error('SETTINGS_ENCRYPTION_KEY (or a JWT secret) must be set to save API keys')
  return createHash('sha256').update(`influnexa-api-keys:${base}`).digest()
}

export function seal(plain: string): Sealed {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return { c: encrypted.toString('base64'), i: iv.toString('base64'), t: cipher.getAuthTag().toString('base64') }
}

// Galat key / kharab data par null (kabhi throw nahi)
export function unseal(sealed: Partial<Sealed> | undefined | null): string | null {
  if (!sealed?.c || !sealed.i || !sealed.t) return null
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(sealed.i, 'base64'))
    decipher.setAuthTag(Buffer.from(sealed.t, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(sealed.c, 'base64')), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}
