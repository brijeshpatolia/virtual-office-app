import { member } from '@vo/db'
import { ACCESS_TOKEN_TTL_MS, TEMPLATE_ID } from '@vo/shared'
import { decodeJwt, decodeProtectedHeader, generateKeyPair, SignJWT } from 'jose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ACCESS_TOKEN_AUDIENCE } from '../../src/auth/verifyAccessToken.ts'
import { createCompany, createInviteLink, newUser, startTestApi, type TestApi, type TestClient } from './helpers.ts'

let api: TestApi
let ownerA: TestClient
let ownerB: TestClient
let companyA: { orgId: string; officeId: string }
let companyB: { orgId: string; officeId: string }

beforeAll(async () => {
  api = await startTestApi()
  ownerA = await newUser(api, 'alice@a.example', 'Alice')
  ownerB = await newUser(api, 'bob@b.example', 'Bob')
  companyA = await createCompany(ownerA, 'Acme Inc.', 'Acme HQ')
  companyB = await createCompany(ownerB, 'Beta', 'Beta Office')
})

afterAll(async () => {
  await api?.close()
})

async function rtToken(client: TestClient, officeId: string) {
  return client.call<{ token: string; expiresAt: string }>(`/api/rt-token?officeId=${officeId}`)
}

describe('POST /api/companies', () => {
  it('creates the company with the caller as owner and its office from the template', async () => {
    const me = await ownerA.call('/api/me')
    expect(me.status).toBe(200)
    expect(me.body).toMatchObject({
      user: { id: ownerA.userId, name: 'Alice', email: 'alice@a.example' },
      orgs: [{ id: companyA.orgId, name: 'Acme Inc.', slug: expect.stringMatching(/^acme-inc-[0-9a-f]{8}$/), role: 'owner' }],
      offices: [{ id: companyA.officeId, orgId: companyA.orgId, name: 'Acme HQ' }],
    })

    const office = await ownerA.call(`/api/offices/${companyA.officeId}`)
    expect(office).toMatchObject({
      status: 200,
      body: { office: { id: companyA.officeId, orgId: companyA.orgId, name: 'Acme HQ', templateId: TEMPLATE_ID, templateVersion: 1 }, role: 'owner' },
    })
  })

  it('makes the new company the active organization of the session', async () => {
    const session = await ownerB.call<{ session: { activeOrganizationId: string } }>('/api/auth/get-session')
    expect(session.body.session.activeOrganizationId).toBe(companyB.orgId)
    expect(session.headers.get('set-auth-jwt')).toBeNull()
  })

  it('validates the request', async () => {
    for (const body of [{}, { companyName: ' ', officeName: 'HQ' }, { companyName: 'x'.repeat(81), officeName: 'HQ' }, { companyName: 'A', officeName: 7 }]) {
      expect(await ownerA.post('/api/companies', body)).toMatchObject({ status: 400, body: { error: 'invalid_request' } })
    }
  })

  it('needs a session', async () => {
    expect(await api.client().post('/api/companies', { companyName: 'A', officeName: 'B' })).toMatchObject({ status: 401, body: { error: 'unauthorized' } })
  })
})

describe('tenant isolation', () => {
  it('shows a user only the companies and offices they belong to', async () => {
    const me = await ownerB.call<{ orgs: { id: string }[]; offices: { id: string }[] }>('/api/me')
    expect(me.body.orgs.map((org) => org.id)).toEqual([companyB.orgId])
    expect(me.body.offices.map((office) => office.id)).toEqual([companyB.officeId])
  })

  it('answers 404 for another company office, its realtime token and its invite links', async () => {
    const notFound = { status: 404, body: { error: 'not_found' } }
    expect(await ownerB.call(`/api/offices/${companyA.officeId}`)).toMatchObject(notFound)
    expect(await rtToken(ownerB, companyA.officeId)).toMatchObject(notFound)
    expect(await ownerB.post(`/api/offices/${companyA.officeId}/invite-links`, { role: 'member' })).toMatchObject(notFound)
    expect(await ownerB.call('/api/offices/does-not-exist')).toMatchObject(notFound)
    expect(await api.getOfficeAccess(ownerB.userId, companyA.officeId)).toBeNull()
  })
})

describe('GET /api/rt-token', () => {
  it('signs an EdDSA JWT for one office that verifyAccessToken accepts', async () => {
    const result = await rtToken(ownerA, companyA.officeId)
    expect(result.status).toBe(200)
    const { token, expiresAt } = result.body

    expect(decodeProtectedHeader(token)).toMatchObject({ alg: 'EdDSA', kid: expect.any(String) })
    const claims = decodeJwt(token)
    expect(claims).toMatchObject({
      sub: ownerA.userId,
      orgId: companyA.orgId,
      officeId: companyA.officeId,
      role: 'owner',
      name: 'Alice',
      aud: ACCESS_TOKEN_AUDIENCE,
      iss: api.env.BETTER_AUTH_URL,
    })
    expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBe(ACCESS_TOKEN_TTL_MS / 1000)
    expect(Date.parse(expiresAt)).toBe((claims.exp ?? 0) * 1000)

    expect(await api.verifyAccessToken(token)).toEqual({
      userId: ownerA.userId,
      orgId: companyA.orgId,
      officeId: companyA.officeId,
      role: 'owner',
      name: 'Alice',
    })
  })

  it('carries the role of the member and a name from the email when the user has none', async () => {
    const link = await createInviteLink(ownerA, companyA.officeId, { role: 'guest' })
    const guest = await newUser(api, 'gina.guest@else.example')
    expect((await guest.post(`/api/invite-links/${link.token}/accept`)).status).toBe(200)

    const result = await rtToken(guest, companyA.officeId)
    expect(await api.verifyAccessToken(result.body.token)).toEqual({
      userId: guest.userId,
      orgId: companyA.orgId,
      officeId: companyA.officeId,
      role: 'guest',
      name: 'gina.guest',
    })
  })

  it('validates the query and needs a session', async () => {
    expect(await ownerA.call('/api/rt-token')).toMatchObject({ status: 400, body: { error: 'invalid_request' } })
    expect(await ownerA.call(`/api/rt-token?officeId=${'x'.repeat(65)}`)).toMatchObject({ status: 400 })
    expect(await rtToken(api.client(), companyA.officeId)).toMatchObject({ status: 401, body: { error: 'unauthorized' } })
  })
})

describe('verifyAccessToken', () => {
  const claimsFor = (officeId: string, orgId: string, sub: string) => ({ sub, orgId, officeId, role: 'owner', name: 'Alice' })

  it('rejects a token whose payload was changed', async () => {
    const { token } = (await rtToken(ownerA, companyA.officeId)).body
    const [header, , signature] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ ...decodeJwt(token), orgId: companyB.orgId, officeId: companyB.officeId })).toString('base64url')
    await expect(api.verifyAccessToken(`${header}.${forged}.${signature}`)).rejects.toThrow()
  })

  it('rejects a token with another audience, such as a Better Auth session JWT', async () => {
    const iat = Math.floor(Date.now() / 1000)
    const { token } = await api.auth.api.signJWT({ body: { payload: { ...claimsFor(companyA.officeId, companyA.orgId, ownerA.userId), iat } } })
    expect(decodeJwt(token).aud).toBe(api.env.BETTER_AUTH_URL)
    await expect(api.verifyAccessToken(token)).rejects.toThrow(/aud/)
  })

  it('rejects an expired token', async () => {
    const iat = Math.floor(Date.now() / 1000) - 1000
    const payload = { ...claimsFor(companyA.officeId, companyA.orgId, ownerA.userId), aud: ACCESS_TOKEN_AUDIENCE, iat, exp: iat + 900 }
    const { token } = await api.auth.api.signJWT({ body: { payload } })
    await expect(api.verifyAccessToken(token)).rejects.toThrow(/exp/)
  })

  it('rejects a token signed with a key that is not ours', async () => {
    const { privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' })
    const token = await new SignJWT(claimsFor(companyA.officeId, companyA.orgId, ownerA.userId))
      .setProtectedHeader({ alg: 'EdDSA', kid: 'foreign' })
      .setIssuer(api.env.BETTER_AUTH_URL)
      .setAudience(ACCESS_TOKEN_AUDIENCE)
      .setSubject(ownerA.userId)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey)
    await expect(api.verifyAccessToken(token)).rejects.toThrow()
    await expect(api.verifyAccessToken('not-a-jwt')).rejects.toThrow()
  })

  it('rejects a signed token without the office claims', async () => {
    const iat = Math.floor(Date.now() / 1000)
    const { token } = await api.auth.api.signJWT({ body: { payload: { sub: ownerA.userId, aud: ACCESS_TOKEN_AUDIENCE, iat } } })
    await expect(api.verifyAccessToken(token)).rejects.toThrow()
  })
})

describe('membership changes', () => {
  async function memberIdOf(userId: string, orgId: string) {
    const rows = await api.database.db.select({ id: member.id, organizationId: member.organizationId, userId: member.userId }).from(member)
    const row = rows.find((r) => r.userId === userId && r.organizationId === orgId)
    if (!row) throw new Error('no member row')
    return row.id
  }

  async function join(email: string, role: 'member' | 'guest') {
    const link = await createInviteLink(ownerA, companyA.officeId, { role })
    const client = await newUser(api, email)
    expect((await client.post(`/api/invite-links/${link.token}/accept`)).status).toBe(200)
    expect((await client.call(`/api/offices/${companyA.officeId}`)).body).toMatchObject({ role })
    return client
  }

  it('ends office access at once when the owner removes a member, despite the 60 s cache', async () => {
    const mia = await join('mia@else.example', 'member')
    expect(await api.getOfficeAccess(mia.userId, companyA.officeId)).toMatchObject({ orgId: companyA.orgId, role: 'member' })

    const removed = await ownerA.post('/api/auth/organization/remove-member', { memberIdOrEmail: 'mia@else.example', organizationId: companyA.orgId })
    expect(removed.status).toBe(200)
    expect(await api.getOfficeAccess(mia.userId, companyA.officeId)).toBeNull()
    expect(await mia.call(`/api/offices/${companyA.officeId}`)).toMatchObject({ status: 404 })
    expect(await rtToken(mia, companyA.officeId)).toMatchObject({ status: 404 })
  })

  it('ends office access at once when a member leaves', async () => {
    const leo = await join('leo@else.example', 'guest')
    expect((await leo.post('/api/auth/organization/leave', { organizationId: companyA.orgId })).status).toBe(200)
    expect(await api.getOfficeAccess(leo.userId, companyA.officeId)).toBeNull()
  })

  it('applies a role change at once', async () => {
    const ada = await join('ada@else.example', 'member')
    expect(await ada.post(`/api/offices/${companyA.officeId}/invite-links`, { role: 'member' })).toMatchObject({ status: 403, body: { error: 'forbidden' } })

    const memberId = await memberIdOf(ada.userId, companyA.orgId)
    const promote = await ownerA.post('/api/auth/organization/update-member-role', { memberId, role: 'admin', organizationId: companyA.orgId })
    expect(promote.status).toBe(200)
    expect((await ada.post(`/api/offices/${companyA.officeId}/invite-links`, { role: 'guest' })).status).toBe(201)

    const demote = await ownerA.post('/api/auth/organization/update-member-role', { memberId, role: 'member', organizationId: companyA.orgId })
    expect(demote.status).toBe(200)
    expect((await ada.post(`/api/offices/${companyA.officeId}/invite-links`, { role: 'guest' })).status).toBe(403)
  })
})
