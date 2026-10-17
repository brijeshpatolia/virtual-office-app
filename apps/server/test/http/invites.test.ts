import { auditLog, findInviteLinkByTokenHash, forOrg } from '@vo/db'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { hashToken } from '../../src/http/routes.ts'
import { CLIENT_ORIGIN, createCompany, createInviteLink, newUser, signIn, startTestApi, type TestApi, type TestClient } from './helpers.ts'

let api: TestApi
let owner: TestClient
let company: { orgId: string; officeId: string }
let users = 0

beforeAll(async () => {
  api = await startTestApi()
  owner = await newUser(api, 'olga@acme.example', 'Olga')
  company = await createCompany(owner, 'Acme', 'Acme HQ')
})

afterAll(async () => {
  await api?.close()
})

afterEach(() => {
  vi.useRealTimers()
})

const someone = () => newUser(api, `user${++users}@else.example`)
const accept = (client: TestClient, token: string) => client.post<{ orgId: string; officeId: string }>(`/api/invite-links/${token}/accept`)
const info = (token: string) => api.client().call<{ companyName: string; officeName: string; role: string; valid: boolean }>(`/api/invite-links/${token}`)

describe('invite links', () => {
  it('creates a link that shows its company and lets a new user join as member', async () => {
    const before = Date.now()
    const link = await createInviteLink(owner, company.officeId, { role: 'member' })
    expect(link.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(link.url).toBe(`${CLIENT_ORIGIN}/invite/${link.token}`)
    const hours = (Date.parse(link.expiresAt) - before) / 3_600_000
    expect(hours).toBeGreaterThan(167.9)
    expect(hours).toBeLessThan(168.1)

    const stored = await findInviteLinkByTokenHash(api.database.db, hashToken(link.token))
    expect(stored?.link).toMatchObject({ orgId: company.orgId, officeId: company.officeId, role: 'member', maxUses: null, uses: 0, createdBy: owner.userId })
    expect(JSON.stringify(stored)).not.toContain(link.token)

    expect(await info(link.token)).toMatchObject({ status: 200, body: { companyName: 'Acme', officeName: 'Acme HQ', role: 'member', valid: true } })

    const joiner = await someone()
    expect(await joiner.call(`/api/offices/${company.officeId}`)).toMatchObject({ status: 404 })
    expect(await accept(joiner, link.token)).toMatchObject({ status: 200, body: { orgId: company.orgId, officeId: company.officeId } })
    expect(await joiner.call(`/api/offices/${company.officeId}`)).toMatchObject({ status: 200, body: { role: 'member' } })
    expect((await joiner.call('/api/me')).body).toMatchObject({ orgs: [{ id: company.orgId, role: 'member' }], offices: [{ id: company.officeId }] })

    // Accepting again changes nothing and counts no use.
    expect(await accept(joiner, link.token)).toMatchObject({ status: 200, body: { orgId: company.orgId } })
    expect((await findInviteLinkByTokenHash(api.database.db, hashToken(link.token)))?.link.uses).toBe(1)

    const actions = (await api.database.db.select({ action: auditLog.action, orgId: auditLog.orgId }).from(auditLog)).filter((row) => row.orgId === company.orgId)
    expect(actions.map((row) => row.action)).toEqual(expect.arrayContaining(['company.create', 'invite_link.create', 'invite_link.accept']))
  })

  it('lets a guest join with the guest role, and guests and members cannot create links', async () => {
    const link = await createInviteLink(owner, company.officeId, { role: 'guest', maxUses: 5, expiresInHours: 2 })
    const guest = await someone()
    expect((await accept(guest, link.token)).status).toBe(200)
    expect(await guest.call(`/api/offices/${company.officeId}`)).toMatchObject({ status: 200, body: { role: 'guest' } })
    expect(await guest.post(`/api/offices/${company.officeId}/invite-links`, { role: 'guest' })).toMatchObject({ status: 403, body: { error: 'forbidden' } })

    const memberLink = await createInviteLink(owner, company.officeId, { role: 'member' })
    const member = await someone()
    expect((await accept(member, memberLink.token)).status).toBe(200)
    expect(await member.post(`/api/offices/${company.officeId}/invite-links`, { role: 'member' })).toMatchObject({ status: 403 })
  })

  it('refuses an expired link', async () => {
    const link = await createInviteLink(owner, company.officeId, { role: 'member', expiresInHours: 1 })
    const late = await someone()
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 2 * 3_600_000 })
    expect((await info(link.token)).body).toMatchObject({ valid: false })
    expect(await accept(late, link.token)).toMatchObject({ status: 410, body: { error: 'invite_invalid' } })
    vi.useRealTimers()
    expect(await late.call(`/api/offices/${company.officeId}`)).toMatchObject({ status: 404 })
  })

  it('refuses a used-up link', async () => {
    const link = await createInviteLink(owner, company.officeId, { role: 'member', maxUses: 1 })
    expect((await accept(await someone(), link.token)).status).toBe(200)
    expect((await info(link.token)).body).toMatchObject({ valid: false })
    expect(await accept(await someone(), link.token)).toMatchObject({ status: 410, body: { error: 'invite_invalid' } })
    expect((await findInviteLinkByTokenHash(api.database.db, hashToken(link.token)))?.link.uses).toBe(1)
  })

  it('refuses a revoked link', async () => {
    const link = await createInviteLink(owner, company.officeId, { role: 'guest' })
    const stored = await findInviteLinkByTokenHash(api.database.db, hashToken(link.token))
    expect(await forOrg(api.database.db, company.orgId).revokeInviteLink(company.officeId, stored?.link.id ?? '')).toBe(true)
    expect((await info(link.token)).body).toMatchObject({ valid: false })
    expect(await accept(await someone(), link.token)).toMatchObject({ status: 410 })
  })

  it('answers 404 for an unknown or malformed token', async () => {
    const unknown = 'A'.repeat(43)
    expect(await info(unknown)).toMatchObject({ status: 404, body: { error: 'not_found' } })
    expect(await info('short')).toMatchObject({ status: 404 })
    expect(await accept(await someone(), unknown)).toMatchObject({ status: 404 })
  })

  it('needs a session to accept and validates the request to create', async () => {
    const link = await createInviteLink(owner, company.officeId, { role: 'member' })
    expect(await accept(api.client(), link.token)).toMatchObject({ status: 401, body: { error: 'unauthorized' } })
    for (const body of [{}, { role: 'owner' }, { role: 'admin' }, { role: 'member', maxUses: 0 }, { role: 'member', expiresInHours: 721 }]) {
      expect(await owner.post(`/api/offices/${company.officeId}/invite-links`, body)).toMatchObject({ status: 400, body: { error: 'invalid_request' } })
    }
  })
})

describe('email invitations', () => {
  it('mails a link to the accept page, and the invitee joins after signing in with that email', async () => {
    const invited = await owner.post<{ id: string }>('/api/auth/organization/invite-member', {
      email: 'ivy@else.example',
      role: 'member',
      organizationId: company.orgId,
    })
    expect(invited.status).toBe(200)
    const invitationId = invited.body.id

    const mail = (await api.mails()).filter((m) => m.to === 'ivy@else.example').at(-1)
    expect(mail?.subject).toBe('Olga invited you to Acme on Virtual Office')
    expect(mail?.text).toContain(`${CLIENT_ORIGIN}/accept-invitation/${invitationId}`)

    const stranger = await someone()
    expect((await stranger.post('/api/auth/organization/accept-invitation', { invitationId })).status).toBe(403)

    const ivy = api.client()
    await signIn(api, ivy, 'ivy@else.example', 'Ivy')
    expect(await ivy.call(`/api/offices/${company.officeId}`)).toMatchObject({ status: 404 })
    const accepted = await ivy.post<{ member: { role: string } }>('/api/auth/organization/accept-invitation', { invitationId })
    expect(accepted.status).toBe(200)
    expect(accepted.body.member.role).toBe('member')
    expect(await ivy.call(`/api/offices/${company.officeId}`)).toMatchObject({ status: 200, body: { role: 'member' } })
  })

  it('does not let members invite by email', async () => {
    const link = await createInviteLink(owner, company.officeId, { role: 'member' })
    const member = await someone()
    expect((await accept(member, link.token)).status).toBe(200)
    const result = await member.post('/api/auth/organization/invite-member', { email: 'x@else.example', role: 'member', organizationId: company.orgId })
    expect(result.status).toBe(403)
  })
})
