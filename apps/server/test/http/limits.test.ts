import { decodeJwt } from 'jose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { INVITATION_MAILS_PER_RECIPIENT, MAX_OWNED_COMPANIES } from '../../src/auth/auth.ts'
import { displayName } from '../../src/http/routes.ts'
import { plainMailText } from '../../src/mail/plainText.ts'
import { createCompany, newUser, startTestApi, type TestApi, type TestClient } from './helpers.ts'

// Limits on what one signed-up user can create or make the server send: names, companies, invitation mails.
let api: TestApi
let users = 0

beforeAll(async () => {
  api = await startTestApi()
})

afterAll(async () => {
  await api?.close()
})

const someone = (name?: string) => newUser(api, `user${++users}@limits.example`, name)
const nameOf = async (client: TestClient) => (await client.call<{ user: { name: string } }>('/api/me')).body.user.name

describe('names', () => {
  it('trims a display name and refuses one that is too long or has a line break', async () => {
    const eve = await someone()
    expect((await eve.post('/api/auth/update-user', { name: '  Eve  ' })).status).toBe(200)
    expect(await nameOf(eve)).toBe('Eve')
    for (const name of ['x'.repeat(81), 'Eve\nVerify now', 'Eve\u0007', '', '   ', 42, null]) {
      expect((await eve.post('/api/auth/update-user', { name })).status, JSON.stringify(name)).toBe(400)
    }
    expect((await eve.post('/api/auth/update-user', { name: 'x'.repeat(2_000) })).status).toBe(400)
    expect(await nameOf(eve)).toBe('Eve')
    expect((await eve.post('/api/auth/update-user', { name: 'x'.repeat(80) })).status).toBe(200)
  })

  it('checks the name given at the first sign-in', async () => {
    const client = api.client()
    const sent = await client.post('/api/auth/email-otp/send-verification-otp', { email: 'long@limits.example', type: 'sign-in' })
    expect(sent.status).toBe(200)
    const otp = (await api.mails()).filter((m) => m.to === 'long@limits.example').at(-1)?.text.match(/code is (\d{6})/)?.[1]
    expect((await client.post('/api/auth/sign-in/email-otp', { email: 'long@limits.example', otp, name: 'y'.repeat(5000) })).status).toBe(400)
    expect((await client.post('/api/auth/sign-in/email-otp', { email: 'long@limits.example', otp, name: ' Lou ' })).status).toBe(200)
    expect(await nameOf(client)).toBe('Lou')
  })

  it('checks a company rename and keeps every name in the realtime token short', async () => {
    const ola = await someone('Ola')
    const company = await createCompany(ola, 'Short Co')
    const rename = (name: unknown) => ola.post('/api/auth/organization/update', { organizationId: company.orgId, data: { name } })
    expect((await rename('z'.repeat(500))).status).toBe(400)
    expect((await rename('Security Team\nhttp://evil.example/reset')).status).toBe(400)
    expect((await rename(' Renamed Co ')).status).toBe(200)
    expect((await ola.call<{ orgs: Array<{ name: string }> }>('/api/me')).body.orgs[0]?.name).toBe('Renamed Co')

    const rt = await ola.call<{ token: string }>(`/api/rt-token?officeId=${company.officeId}`)
    expect(decodeJwt(rt.body.token).name).toBe('Ola')
    expect(displayName({ name: 'n'.repeat(300), email: 'a@b.example' })).toHaveLength(80)
    expect(displayName({ name: '  ', email: 'gina@b.example' })).toBe('gina')
  })
})

describe('companies', () => {
  it('creates companies only through POST /api/companies, at most MAX_OWNED_COMPANIES per owner', async () => {
    const kai = await someone('Kai')
    expect((await kai.post('/api/auth/organization/create', { name: 'No office', slug: `no-office-${users}` })).status).toBe(404)
    for (let i = 0; i < MAX_OWNED_COMPANIES; i++) await createCompany(kai, `Kai Co ${i}`)
    expect(await kai.post('/api/companies', { companyName: 'One more', officeName: 'HQ' })).toMatchObject({
      status: 403,
      body: { error: 'forbidden', message: 'company_limit' },
    })
    expect((await kai.call<{ orgs: unknown[] }>('/api/me')).body.orgs).toHaveLength(MAX_OWNED_COMPANIES)
  })
})

describe('invitation mails', () => {
  it('caps the mails to one address per day, resends included', async () => {
    const ivo = await someone('Ivo')
    const company = await createCompany(ivo, 'Mail Co')
    const before = (await api.mails()).length
    const invite = (resend: boolean) =>
      ivo.post('/api/auth/organization/invite-member', { email: 'Victim@Target.example', role: 'member', organizationId: company.orgId, resend })
    const statuses = [(await invite(false)).status]
    for (let i = 0; i < INVITATION_MAILS_PER_RECIPIENT + 2; i++) statuses.push((await invite(true)).status)
    expect(statuses).toEqual([...Array<number>(INVITATION_MAILS_PER_RECIPIENT).fill(200), 429, 429, 429])
    const sent = (await api.mails()).slice(before).filter((m) => m.to === 'victim@target.example')
    expect(sent).toHaveLength(INVITATION_MAILS_PER_RECIPIENT)
  })

  it('does not let people outside a company, or its members, use up its quota for an address', async () => {
    const owner = await someone('Ona')
    const company = await createCompany(owner, 'Quota Co')
    const stranger = await someone('Sam')
    const invite = (client: TestClient) =>
      client.post('/api/auth/organization/invite-member', { email: 'new.hire@limits.example', role: 'member', organizationId: company.orgId })
    for (let i = 0; i < INVITATION_MAILS_PER_RECIPIENT + 1; i++) expect((await invite(stranger)).status).toBe(400)
    expect((await invite(owner)).status).toBe(200)
  })

  it('keeps links and line breaks of user-chosen names out of the mail', async () => {
    const pat = await someone('Pat http://evil.example/login now')
    const company = await createCompany(pat, 'Acme www.evil.example')
    expect((await pat.post('/api/auth/organization/invite-member', { email: 'friend@limits.example', role: 'guest', organizationId: company.orgId })).status).toBe(200)
    const mail = (await api.mails()).filter((m) => m.to === 'friend@limits.example').at(-1)
    expect(mail?.subject).toBe('Pat now invited you to Acme on Virtual Office')
    expect(mail?.text).not.toMatch(/evil/)
    expect(mail?.text).toContain('/accept-invitation/')
  })

  it('shortens and cleans text for mails', () => {
    expect(plainMailText('Ann\r\nVerify at https://evil.example/x today', 'Someone')).toBe('Ann Verify at today')
    expect(plainMailText('see evil.example/login', 'Someone')).toBe('see')
    expect(plainMailText('http://only.example', 'Someone')).toBe('Someone')
    expect(plainMailText('a'.repeat(100), 'Someone')).toBe(`${'a'.repeat(59)}…`)
    expect(plainMailText('Booking.com', 'Someone')).toBe('Booking.com')
  })
})
