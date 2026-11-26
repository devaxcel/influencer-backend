import type { Request } from 'express'
import { env } from '../config/env'
import { AppError } from '../utils/AppError'

export async function verifyRecaptcha(req: Request, token?: string) {
  if (env.nodeEnv === 'test') return
  if (!env.recaptchaSecretKey) return
  if (
    env.nodeEnv === 'development' &&
    env.recaptchaSecretKey === '6LeIxAcTAAAAAGG-vFI1TnRWxMNCFd7fTCnSYI' &&
    token === 'browser-recaptcha-fallback'
  ) return
  if (!token) {
    throw new AppError(400, 'CAPTCHA_REQUIRED', 'Please complete the reCAPTCHA verification')
  }

  const body = new URLSearchParams({
    secret: env.recaptchaSecretKey,
    response: token,
  })
  if (req.ip) body.set('remoteip', req.ip)

  try {
    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10_000),
    })
    const data = await response.json() as { success?: boolean; ['error-codes']?: string[] }
    if (!response.ok || !data.success) {
      const codes = data['error-codes'] ?? []
      // Google ka asal wajah (secret / site key ka mel, token purana, waghera): server log mein, token ya secret ke baghair
      console.warn(`[recaptcha] verification failed: ${codes.join(', ') || `HTTP ${response.status}`}`)
      // Secret galat / site key se nahi milta: ye user ki ghalti nahi, server ki setting hai
      if (codes.includes('invalid-input-secret') || codes.includes('missing-input-secret')) {
        throw new AppError(500, 'CAPTCHA_MISCONFIGURED', 'reCAPTCHA is not set up correctly on the server. Please contact support.')
      }
      // Token purana ya do dafa use hua: dobara tick karna kaafi hai
      if (codes.includes('timeout-or-duplicate')) {
        throw new AppError(400, 'CAPTCHA_FAILED', 'The reCAPTCHA expired. Please tick it again and retry.')
      }
      throw new AppError(400, 'CAPTCHA_FAILED', 'reCAPTCHA verification failed')
    }
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError(400, 'CAPTCHA_FAILED', 'reCAPTCHA verification could not be completed')
  }
}
