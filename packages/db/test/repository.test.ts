import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, forOrg, forUser, findInviteLinkByTokenHash, member, newId, organization, user, type DbHandle } from '../src/index.ts'

let handle: DbHandle

async function seedOrg(name: string) {
  const orgId = newId()
  await handle.db.insert(organization).values({ id: orgId, name, slug: `${name}-${orgId}`, createdAt: new Date() })
  return orgId
}

async function seedUser(email: string) {
  const id = newId()
  await handle.db.insert(user).values({ id, name: email, email })
  return id
}

beforeAll(async () => {
  handle = await createDb({ PGLITE_DIR: 'memory://' })
})

afterAll(async () => {
  await handle.close()
})

describe('createDb', () => {
  it('opens PGlite in memory and applies the migrations', () => {
    expect(handle.kind).toBe('pglite')
  })
})

describe('newId', () => {
  it('makes 32 characters from [A-Za-z0-9], like Better Auth', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newId()))
    expect(ids.size).toBe(200)
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9]{32}$/)
  })
})

describe('forOrg', () => {
  it('refuses an empty orgId', () => {
    expect(() => forOrg(handle.db, '')).toThrow(/orgId/)
    expect(() => forUser(handle.db, '')).toThrow(/userId/)
  })

  it('never returns another company office', async () => {
    const a = forOrg(handle.db, await seedOrg('a'))
    const b = forOrg(handle.db, await seedOrg('b'))
    const office = await a.createOffice({ name: 'HQ', templateId: 't', templateVersion: 1 })
    expect(await a.getOffice(office.id)).toMatchObject({ id: office.id, orgId: a.orgId, settings: {} })
    expect(await b.getOffice(office.id)).toBeNull()
    expect(await b.listOffices()).toEqual([])
  })

  it('rejects an invite link whose office belongs to another company', async () => {
    const a = forOrg(handle.db, await seedOrg('c'))
    const b = forOrg(handle.db, await seedOrg('d'))
    const createdBy = await seedUser('d-admin@example.com')
    const office = await a.createOffice({ name: 'HQ', templateId: 't', templateVersion: 1 })
    const input = { officeId: office.id, tokenHash: newId(), role: 'member' as const, maxUses: null, expiresAt: new Date(Date.now() + 60_000), createdBy }
    await expect(b.createInviteLink(input)).rejects.toThrow()
  })

  it('counts invite link uses atomically up to maxUses', async () => {
    const org = forOrg(handle.db, await seedOrg('e'))
    const other = forOrg(handle.db, await seedOrg('f'))
    const createdBy = await seedUser('e-admin@example.com')
    const office = await org.createOffice({ name: 'HQ', templateId: 't', templateVersion: 1 })
    const tokenHash = newId()
    const link = await org.createInviteLink({ officeId: office.id, tokenHash, role: 'guest', maxUses: 2, expiresAt: new Date(Date.now() + 60_000), createdBy })

    expect(await other.consumeInviteLink(link.id)).toBe(false)
    const results = await Promise.all([1, 2, 3, 4].map(() => org.consumeInviteLink(link.id)))
    expect(results.filter(Boolean)).toHaveLength(2)
    expect((await findInviteLinkByTokenHash(handle.db, tokenHash))?.link.uses).toBe(2)

    await org.releaseInviteLink(link.id)
    expect(await org.consumeInviteLink(link.id, new Date(Date.now() + 120_000))).toBe(false)
    expect(await org.revokeInviteLink(link.id)).toBe(true)
    expect(await org.consumeInviteLink(link.id)).toBe(false)
  })
})

describe('forUser', () => {
  it('lists only the companies and offices of the user', async () => {
    const userId = await seedUser('member@example.com')
    const mine = forOrg(handle.db, await seedOrg('mine'))
    const theirs = forOrg(handle.db, await seedOrg('theirs'))
    const myOffice = await mine.createOffice({ name: 'Mine', templateId: 't', templateVersion: 1 })
    const theirOffice = await theirs.createOffice({ name: 'Theirs', templateId: 't', templateVersion: 1 })
    await handle.db.insert(member).values({ id: newId(), organizationId: mine.orgId, userId, role: 'guest', createdAt: new Date() })

    const me = forUser(handle.db, userId)
    expect((await me.memberships()).map((m) => [m.orgId, m.role])).toEqual([[mine.orgId, 'guest']])
    expect((await me.offices()).map((o) => o.id)).toEqual([myOffice.id])
    expect(await me.officeMembership(myOffice.id)).toMatchObject({ role: 'guest', office: { id: myOffice.id } })
    expect(await me.officeMembership(theirOffice.id)).toBeNull()
  })

  it('allows one membership per user and company', async () => {
    const userId = await seedUser('twice@example.com')
    const orgId = await seedOrg('twice')
    const row = () => ({ id: newId(), organizationId: orgId, userId, role: 'member', createdAt: new Date() })
    await handle.db.insert(member).values(row())
    await expect(handle.db.insert(member).values(row())).rejects.toThrow()
  })
})
