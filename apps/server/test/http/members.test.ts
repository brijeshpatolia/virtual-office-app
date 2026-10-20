import { auditLog, findInviteLinkByTokenHash, member } from '@vo/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { toOrgRole } from '../../src/auth/access.ts'
import { hashToken } from '../../src/http/routes.ts'
import { createCompany, createInviteLink, newUser, startTestApi, type TestApi, type TestClient } from './helpers.ts'

// Removing members, the invite links of an office, guests and the company directory, and the role values.
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

const links = (officeId = company.officeId) => `/api/offices/${officeId}/invite-links`
const accept = (client: TestClient, token: string) => client.post(`/api/invite-links/${token}/accept`)
const info = (token: string) => api.client().call<{ valid: boolean }>(`/api/invite-links/${token}`)

async function join(role: 'member' | 'guest', name?: string): Promise<TestClient> {
  const link = await createInviteLink(owner, company.officeId, { role })
  const client = await newUser(api, `user${++users}@else.example`, name)
  expect((await accept(client, link.token)).status).toBe(200)
  return client
}

async function memberIdOf(userId: string): Promise<string> {
  const rows = await api.database.db.select().from(member)
  const row = rows.find((r) => r.userId === userId && r.organizationId === company.orgId)
  if (!row) throw new Error('no member row')
  return row.id
}

const remove = (client: TestClient) =>
  owner.post('/api/auth/organization/remove-member', { memberIdOrEmail: client.user?.email, organizationId: company.orgId })

describe('invite links of an office', () => {
  it('lists the open links to owners and admins, and revokes one', async () => {
    const first = await createInviteLink(owner, company.officeId, { role: 'member', maxUses: 3 })
    const second = await createInviteLink(owner, company.officeId, { role: 'guest' })
    const listed = await owner.call<{ links: Array<{ id: string; role: string; maxUses: number | null; createdBy: string }> }>(links())
    expect(listed.status).toBe(200)
    const [newest, older] = listed.body.links
    expect(newest).toMatchObject({ role: 'guest', maxUses: null, uses: 0, createdBy: 'Olga' })
    expect(older).toMatchObject({ role: 'member', maxUses: 3, createdBy: 'Olga' })
    expect(JSON.stringify(listed.body)).not.toContain(first.token)

    const linkId = newest?.id ?? ''
    expect(await owner.call(`${links()}/${linkId}`, { method: 'DELETE', origin: null })).toMatchObject({ status: 403 })
    expect(await owner.call(`${links()}/${linkId}`, { method: 'DELETE' })).toMatchObject({ status: 200, body: { id: linkId, revoked: true } })
    expect(await owner.call(`${links()}/${linkId}`, { method: 'DELETE' })).toMatchObject({ status: 404 })
    expect((await info(second.token)).body.valid).toBe(false)
    expect(await accept(await newUser(api, `user${++users}@else.example`), second.token)).toMatchObject({ status: 410 })
    const ids = (await owner.call<{ links: Array<{ id: string }> }>(links())).body.links.map((l) => l.id)
    expect(ids).not.toContain(linkId)
    const actions = await api.database.db.select({ action: auditLog.action, targetId: auditLog.targetId }).from(auditLog)
    expect(actions).toContainEqual({ action: 'invite_link.revoke', targetId: linkId })
  })

  it('shows and revokes links only for owners and admins of the office', async () => {
    const link = await createInviteLink(owner, company.officeId, { role: 'member' })
    const linkId = (await findInviteLinkByTokenHash(api.database.db, hashToken(link.token)))?.link.id ?? ''
    const mem = await join('member')
    expect(await mem.call(links())).toMatchObject({ status: 403, body: { error: 'forbidden' } })
    expect(await mem.call(`${links()}/${linkId}`, { method: 'DELETE' })).toMatchObject({ status: 403 })

    const other = await newUser(api, `user${++users}@other.example`)
    const otherCompany = await createCompany(other, 'Other')
    expect(await other.call(links())).toMatchObject({ status: 404 })
    expect(await other.call(`${links()}/${linkId}`, { method: 'DELETE' })).toMatchObject({ status: 404 })
    // A link id of another office does not revoke anything.
    expect(await other.call(`${links(otherCompany.officeId)}/${linkId}`, { method: 'DELETE' })).toMatchObject({ status: 404 })
    expect((await info(link.token)).body.valid).toBe(true)
  })
})

describe('removing a member', () => {
  it('keeps them out, also with the link they joined with, until an email invitation lets them back in', async () => {
    const link = await createInviteLink(owner, company.officeId, { role: 'member' })
    const mia = await newUser(api, 'mia@else.example', 'Mia')
    expect((await accept(mia, link.token)).status).toBe(200)
    expect((await remove(mia)).status).toBe(200)
    expect(await mia.call(`/api/offices/${company.officeId}`)).toMatchObject({ status: 404 })

    expect(await accept(mia, link.token)).toMatchObject({ status: 403, body: { error: 'forbidden', message: 'removed' } })
    const fresh = await createInviteLink(owner, company.officeId, { role: 'member' })
    expect(await accept(mia, fresh.token)).toMatchObject({ status: 403 })
    expect(await mia.call(`/api/offices/${company.officeId}`)).toMatchObject({ status: 404 })
    expect(await mia.call(`/api/rt-token?officeId=${company.officeId}`)).toMatchObject({ status: 404 })
    // The link keeps its uses for others.
    expect((await findInviteLinkByTokenHash(api.database.db, hashToken(link.token)))?.link.uses).toBe(1)
    const actions = await api.database.db.select({ action: auditLog.action, actorId: auditLog.actorId, targetId: auditLog.targetId }).from(auditLog)
    expect(actions).toContainEqual({ action: 'member.remove', actorId: owner.userId, targetId: mia.userId })

    const invited = await owner.post<{ id: string }>('/api/auth/organization/invite-member', {
      email: 'mia@else.example',
      role: 'guest',
      organizationId: company.orgId,
    })
    expect(invited.status).toBe(200)
    expect((await mia.post('/api/auth/organization/accept-invitation', { invitationId: invited.body.id })).status).toBe(200)
    expect(await mia.call(`/api/offices/${company.officeId}`)).toMatchObject({ status: 200, body: { role: 'guest' } })
    // Removed again, the links keep her out again.
    expect((await remove(mia)).status).toBe(200)
    expect(await accept(mia, fresh.token)).toMatchObject({ status: 403 })
  })

  it('revokes the links that the removed member or a member who left created', async () => {
    const adam = await join('member', 'Adam')
    const memberId = await memberIdOf(adam.userId)
    expect((await owner.post('/api/auth/organization/update-member-role', { memberId, role: 'admin', organizationId: company.orgId })).status).toBe(200)
    const adamLink = await createInviteLink(adam, company.officeId, { role: 'member' })
    const ownerLink = await createInviteLink(owner, company.officeId, { role: 'member' })
    expect((await remove(adam)).status).toBe(200)
    expect((await info(adamLink.token)).body.valid).toBe(false)
    expect((await info(ownerLink.token)).body.valid).toBe(true)

    const ada = await join('member', 'Ada')
    const adaId = await memberIdOf(ada.userId)
    expect((await owner.post('/api/auth/organization/update-member-role', { memberId: adaId, role: 'admin', organizationId: company.orgId })).status).toBe(200)
    const adaLink = await createInviteLink(ada, company.officeId, { role: 'guest' })
    expect((await ada.post('/api/auth/organization/leave', { organizationId: company.orgId })).status).toBe(200)
    expect((await info(adaLink.token)).body.valid).toBe(false)
    // Leaving is not a removal: a new link lets her back in.
    expect((await accept(ada, ownerLink.token)).status).toBe(200)
  })
})

describe('guests and the company directory', () => {
  it('refuses the member list and the invitations to guests, by id, by slug and for the active company', async () => {
    await owner.post('/api/auth/organization/invite-member', { email: 'secret.candidate@else.example', role: 'member', organizationId: company.orgId })
    const gus = await join('guest', 'Gus')
    const mem = await join('member', 'Mo')
    const slug = (await owner.call<{ orgs: Array<{ slug: string }> }>('/api/me')).body.orgs[0]?.slug ?? ''
    const byId = `organizationId=${company.orgId}`
    for (const path of ['list-members', 'list-invitations', 'get-full-organization']) {
      const asGuest = await gus.call(`/api/auth/organization/${path}?${byId}`)
      expect(asGuest.status, path).toBe(403)
      expect(JSON.stringify(asGuest.body)).not.toContain('@')
      expect((await mem.call(`/api/auth/organization/${path}?${byId}`)).status, path).toBe(200)
    }
    expect((await gus.call(`/api/auth/organization/list-members?organizationSlug=${slug}`)).status).toBe(403)
    expect((await gus.call(`/api/auth/organization/get-full-organization?organizationSlug=${slug}`)).status).toBe(403)
    expect((await gus.post('/api/auth/organization/set-active', { organizationId: company.orgId })).status).toBe(200)
    expect((await gus.call('/api/auth/organization/list-members')).status).toBe(403)
    expect((await gus.call('/api/auth/organization/list-invitations')).status).toBe(403)
    // Their own membership stays readable.
    expect((await gus.call(`/api/auth/organization/get-active-member?${byId}`)).status).toBe(200)
  })
})

describe('roles', () => {
  it('stores only one exact role, so Better Auth and the app agree on it', async () => {
    const adam = await join('member', 'Adm')
    const memberId = await memberIdOf(adam.userId)
    expect((await owner.post('/api/auth/organization/update-member-role', { memberId, role: 'admin', organizationId: company.orgId })).status).toBe(200)
    expect((await adam.post('/api/auth/organization/invite-member', { email: 'p0@else.example', role: 'owner', organizationId: company.orgId })).status).toBe(403)
    let n = 0
    for (const role of ['member, owner', 'owner ', ' owner', ['member', ' owner'], 'admin,member']) {
      const result = await adam.post('/api/auth/organization/invite-member', { email: `p${++n}@else.example`, role, organizationId: company.orgId })
      expect(result, JSON.stringify(role)).toMatchObject({ status: 400 })
    }
    // update-member-role trims each role itself ('owner ' becomes 'owner'); lists stay refused.
    for (const role of ['member, owner', 'admin,member', ['admin', 'member']]) {
      const result = await owner.post('/api/auth/organization/update-member-role', { memberId, role, organizationId: company.orgId })
      expect(result.status, JSON.stringify(role)).toBe(400)
    }
    expect(await adam.call(`/api/offices/${company.officeId}`)).toMatchObject({ status: 200, body: { role: 'admin' } })
    const invited = await adam.post<{ role: string }>('/api/auth/organization/invite-member', { email: 'ok@else.example', role: 'guest', organizationId: company.orgId })
    expect(invited).toMatchObject({ status: 200, body: { role: 'guest' } })
  })

  it('reads a stored role list the way Better Auth does', () => {
    expect(toOrgRole('owner')).toBe('owner')
    expect(toOrgRole('admin,member')).toBe('admin')
    expect(toOrgRole('member, owner')).toBe('member')
    expect(toOrgRole('owner ')).toBeNull()
    expect(toOrgRole(' owner')).toBeNull()
    expect(toOrgRole('')).toBeNull()
  })
})
