import type { Env } from '../env.ts'

export interface MailMessage {
  to: string
  subject: string
  text: string
}

export interface Mailer {
  sendMail(message: MailMessage): Promise<void>
}

// Production: Resend (RESEND_API_KEY, EMAIL_FROM). Development: print the mail and append it to
// env.DEV_MAIL_LOG, so the sign-in code is visible without an email account. Never log mail in production.
export function createMailer(env: Env): Mailer {
  void env
  return {
    async sendMail() {
      throw new Error('Not implemented: sendMail')
    },
  }
}
