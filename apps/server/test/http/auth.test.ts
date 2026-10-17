import { verification } from '@vo/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createAuth } from '../../src/auth/auth.ts'
import { requestCode, signIn, startTestApi, type TestApi } from './helpers.ts'

let api: TestApi

beforeAll(async () => {
  api = await startTestApi()
})

afterAll(async () => {
  await api?.close()
})

describe('email OTP', () => {
  it('signs up a new email with the code from the dev mailer and keeps the session in an httpOnly cookie', async () => {
    const client = api.client()
    const code = await requestCode(api, client, 'ann@example.com')
    expect(code).toMatch(/^\d{6}$/)

    const mail = (await api.mails()).at(-1)
    expect(mail).toMatchObject({ to: 'ann@example.com', subject: `Your Virtual Office sign-in code: ${code}` })
    expect(Date.parse(mail?.at ?? '')).not.toBeNaN()

    const signedIn = await client.post<{ user: { email: string; name: string; emailVerified: boolean } }>('/api/auth/sign-in/email-otp', {
      email: 'ann@example.com',
      otp: code,
      name: 'Ann',
    })
    expect(signedIn.status).toBe(200)
    expect(signedIn.body.user).toMatchObject({ email: 'ann@example.com', name: 'Ann', emailVerified: true })
    const cookie = signedIn.headers.getSetCookie().find((c) => c.startsWith('better-auth.session_token='))
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=Lax/i)

    const me = await client.call('/api/me')
    expect(me.status).toBe(200)
    expect(me.body).toEqual({
      user: { id: expect.any(String), name: 'Ann', email: 'ann@example.com', image: null },
      orgs: [],
      offices: [],
    })
  })

  it('signs in an existing user again with a new code', async () => {
    const first = api.client()
    const user = await signIn(api, first, 'bert@example.com', 'Bert')
    const second = api.client()
    const again = await signIn(api, second, 'bert@example.com')
    expect(again.id).toBe(user.id)
    expect(again.name).toBe('Bert')
  })

  it('refuses a wrong code and stores codes hashed', async () => {
    const client = api.client()
    const code = await requestCode(api, client, 'cleo@example.com')
    const stored = await api.database.db.select({ value: verification.value }).from(verification)
    expect(stored.length).toBeGreaterThan(0)
    expect(stored.map((row) => row.value).some((value) => value.includes(code))).toBe(false)

    const wrong = await client.post('/api/auth/sign-in/email-otp', { email: 'cleo@example.com', otp: code === '000000' ? '111111' : '000000' })
    expect(wrong.status).toBe(400)
    expect(client.cookies.size).toBe(0)
    expect((await client.call('/api/me')).status).toBe(401)

    const right = await client.post('/api/auth/sign-in/email-otp', { email: 'cleo@example.com', otp: code })
    expect(right.status).toBe(200)
  })

  it('refuses auth requests from an untrusted origin', async () => {
    const client = api.client()
    const result = await client.post('/api/auth/email-otp/send-verification-otp', { email: 'eve@example.com', type: 'sign-in' }, { origin: 'http://evil.example' })
    expect(result.status).toBe(403)
    expect(result.body).toMatchObject({ code: 'INVALID_ORIGIN' })
  })

  it('rate limits sign-in codes per IP', async () => {
    const client = api.client()
    const statuses: number[] = []
    for (let i = 0; i < 4; i += 1) {
      statuses.push((await client.post('/api/auth/email-otp/send-verification-otp', { email: `flood${i}@example.com`, type: 'sign-in' })).status)
    }
    expect(statuses).toEqual([200, 200, 200, 429])
  })

  it('uses Secure __Secure- session cookies in production', async () => {
    const env = { ...api.env, NODE_ENV: 'production' as const, isProduction: true }
    const auth = createAuth({ env, db: api.database.db, mailer: { sendMail: async () => {} } })
    const { authCookies } = await auth.$context
    expect(authCookies.sessionToken).toMatchObject({
      name: '__Secure-better-auth.session_token',
      attributes: { secure: true, httpOnly: true, sameSite: 'lax' },
    })
  })

  it('signs out', async () => {
    const client = api.client()
    await signIn(api, client, 'dora@example.com')
    expect((await client.post('/api/auth/sign-out')).status).toBe(200)
    expect((await client.call('/api/me')).status).toBe(401)
  })
})

describe('/api guards', () => {
  it('answers 401 unauthorized without a session', async () => {
    const result = await api.client().call('/api/me')
    expect(result).toMatchObject({ status: 401, body: { error: 'unauthorized' } })
    expect(result.headers.get('cache-control')).toBe('no-store')
  })

  it('refuses a state change without the client origin', async () => {
    const client = api.client()
    await signIn(api, client, 'otto@example.com')
    const body = { companyName: 'Acme', officeName: 'HQ' }
    expect(await client.post('/api/companies', body, { origin: null })).toMatchObject({ status: 403, body: { error: 'forbidden' } })
    expect(await client.post('/api/companies', body, { origin: 'http://evil.example' })).toMatchObject({ status: 403, body: { error: 'forbidden' } })
  })

  it('tells the client whether Google sign-in is configured', async () => {
    expect(await api.client().call('/api/config')).toMatchObject({ status: 200, body: { google: false } })
    const withGoogle = await startTestApi({ GOOGLE_CLIENT_ID: 'id.apps.example', GOOGLE_CLIENT_SECRET: 'secret' })
    try {
      expect(await withGoogle.client().call('/api/config')).toMatchObject({ status: 200, body: { google: true } })
    } finally {
      await withGoogle.close()
    }
  })

  it('keeps Better Auth’s own session JWT endpoint off', async () => {
    const client = api.client()
    await signIn(api, client, 'tess@example.com')
    expect((await client.call('/api/auth/token')).status).toBe(404)
  })
})
