import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadEnv } from '../../src/env.ts'
import { createMailer, RESEND_API_URL } from '../../src/mail/mailer.ts'
import { readMails } from './helpers.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createMailer', () => {
  it('appends one JSON line per mail to the dev mail log, creating its folder', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vo-mail-'))
    try {
      const env = loadEnv({ NODE_ENV: 'test', DATA_DIR: join(dir, 'nested', 'data') })
      const mailer = createMailer(env)
      await mailer.sendMail({ to: 'a@example.com', subject: 'One', text: 'first\nline' })
      await mailer.sendMail({ to: 'b@example.com', subject: 'Two', text: 'second' })
      const mails = await readMails(env.DEV_MAIL_LOG)
      expect(mails).toEqual([
        { to: 'a@example.com', subject: 'One', text: 'first\nline', at: expect.any(String) },
        { to: 'b@example.com', subject: 'Two', text: 'second', at: expect.any(String) },
      ])
      expect(Object.keys(mails[0] ?? {})).toEqual(['to', 'subject', 'text', 'at'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('refuses to run in production without Resend', () => {
    const env = { ...loadEnv({ NODE_ENV: 'test' }), NODE_ENV: 'production' as const, isProduction: true }
    expect(() => createMailer(env)).toThrow(/RESEND_API_KEY/)
  })

  it('sends through the Resend HTTP API when RESEND_API_KEY is set, and never logs the mail', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"id":"1"}', { status: 200 }))
    const log = vi.spyOn(console, 'log')
    const env = loadEnv({ NODE_ENV: 'test', RESEND_API_KEY: 're_test', EMAIL_FROM: 'Office <office@example.com>' })
    await createMailer(env).sendMail({ to: 'a@example.com', subject: 'Code', text: '123456' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(RESEND_API_URL)
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer re_test')
    expect(JSON.parse(String(init?.body))).toEqual({ from: 'Office <office@example.com>', to: ['a@example.com'], subject: 'Code', text: '123456' })
    expect(log).not.toHaveBeenCalled()
  })

  it('throws when Resend refuses the mail', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"message":"invalid from"}', { status: 422 }))
    const env = loadEnv({ NODE_ENV: 'test', RESEND_API_KEY: 're_test' })
    await expect(createMailer(env).sendMail({ to: 'a@example.com', subject: 'S', text: 'T' })).rejects.toThrow(/422/)
  })
})
