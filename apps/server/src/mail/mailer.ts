import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Env } from '../env.ts'

export interface MailMessage {
  to: string
  subject: string
  text: string
}

export interface Mailer {
  sendMail(message: MailMessage): Promise<void>
}

export const RESEND_API_URL = 'https://api.resend.com/emails'

// RESEND_API_KEY set: Resend (EMAIL_FROM). Otherwise, outside production: print the mail and append it to
// env.DEV_MAIL_LOG, so the sign-in code is visible without an email account. Production never logs mail.
export function createMailer(env: Env): Mailer {
  if (env.RESEND_API_KEY) return createResendMailer(env.RESEND_API_KEY, env.EMAIL_FROM)
  if (env.isProduction) throw new Error('RESEND_API_KEY is required in production; mail is never logged there')
  return createDevMailer(env.DEV_MAIL_LOG, env.NODE_ENV === 'development')
}

export function createResendMailer(apiKey: string, from: string): Mailer {
  return {
    async sendMail({ to, subject, text }) {
      const response = await fetch(RESEND_API_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject, text }),
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) throw new Error(`Resend answered ${response.status}: ${(await response.text()).slice(0, 300)}`)
    },
  }
}

// One JSON line per mail: {to, subject, text, at}.
export function createDevMailer(logPath: string, print: boolean): Mailer {
  return {
    async sendMail(message) {
      await mkdir(dirname(logPath), { recursive: true })
      const at = new Date().toISOString()
      await appendFile(logPath, `${JSON.stringify({ to: message.to, subject: message.subject, text: message.text, at })}\n`)
      if (print) console.log(`\n--- mail (dev, not sent) to ${message.to}: ${message.subject}\n${message.text}\n---`)
    },
  }
}
