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
      throw new AppError(400, 'CAPTCHA_FAILED', 'reCAPTCHA verification failed')
    }
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError(400, 'CAPTCHA_FAILED', 'reCAPTCHA verification could not be completed')
  }
}
