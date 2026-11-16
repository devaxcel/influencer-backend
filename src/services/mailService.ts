import { env, isProduction } from '../config/env'
import { AppError } from '../utils/AppError'

export interface MailMessage {
  to: string
  subject: string
  text: string
  html: string
}

const RESEND_API = 'https://api.resend.com/emails'

export const isMailConfigured = () => Boolean(env.resendApiKey)

// Bhejne wala: MAIL_FROM (Resend mein verified domain ka address). Na ho to Resend ka
// test address, jo sirf Resend account wali apni email pe bhej sakta hai
function sender() {
  return env.mailFrom || `${env.platformName} <onboarding@resend.dev>`
}

// Email Resend API se bhejta hai. RESEND_API_KEY na ho to development mein terminal pe dikha deta hai
export async function sendMail(message: MailMessage) {
  if (!isMailConfigured()) {
    if (isProduction) {
      throw new AppError(503, 'EMAIL_NOT_CONFIGURED', 'Email service is not set up yet')
    }
    console.info(`[mail] To: ${message.to}\n[mail] Subject: ${message.subject}\n${message.text}`)
    return
  }

  let res: Response
  try {
    res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      // Vercel function zyada der nahi chalta: Resend atke to jaldi saaf error do
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        from: sender(),
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    })
  } catch (error) {
    console.error('[mail] send failed', error)
    throw new AppError(503, 'EMAIL_FAILED', 'We could not send the email. Please try again')
  }

  if (!res.ok) {
    // Resend ka jawab: { statusCode, name, message } (jaise domain verified nahi)
    const detail = await res.text().catch(() => '')
    console.error(`[mail] Resend answered ${res.status}`, detail)
    throw new AppError(503, 'EMAIL_FAILED', 'We could not send the email. Please try again')
  }
}
