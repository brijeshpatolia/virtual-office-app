import { createDb, forOrg, newId, organization, presenceSessions, user, type DbHandle } from '@vo/db'
import { DEFAULT_GUEST_ZONE_TYPES } from '@vo/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRoomStore, roomSettingsFrom } from '../../src/rooms/store.ts'

let handle: DbHandle
beforeAll(async () => {
  handle = await createDb({ PGLITE_DIR: 'memory://' })
})
afterAll(() => handle.close())

async function seed(settings: Record<string, unknown> = {}) {
  const orgId = newId()
  const userId = newId()
  await handle.db.insert(organization).values({ id: orgId, name: 'Acme', slug: `acme-${orgId}`, createdAt: new Date() })
  await handle.db.insert(user).values({ id: userId, name: 'Ann', email: `${userId}@example.com` })
  const office = await forOrg(handle.db, orgId).createOffice({ name: 'HQ', templateId: 't', templateVersion: 1, settings })
  return { orgId, userId, officeId: office.id }
}

describe('roomSettingsFrom', () => {
  it('reads guestZoneTypes and falls back to the defaults', () => {
    expect(roomSettingsFrom({ guestZoneTypes: ['lobby'], meetingAutoAV: true })).toEqual({ guestZoneTypes: ['lobby'] })
    expect(roomSettingsFrom({})).toEqual({ guestZoneTypes: DEFAULT_GUEST_ZONE_TYPES })
    expect(roomSettingsFrom({ guestZoneTypes: ['lobby', 'roof'] })).toEqual({ guestZoneTypes: DEFAULT_GUEST_ZONE_TYPES })
    expect(roomSettingsFrom(null)).toEqual({ guestZoneTypes: DEFAULT_GUEST_ZONE_TYPES })
  })
})

describe('createRoomStore', () => {
  it('loads the office settings of the right company only', async () => {
    const store = createRoomStore(handle.db)
    const { orgId, officeId } = await seed({ guestZoneTypes: ['lobby', 'hallway'] })
    expect(await store.loadSettings(orgId, officeId)).toEqual({ guestZoneTypes: ['lobby', 'hallway'] })
    const other = await seed()
    expect(await store.loadSettings(other.orgId, officeId)).toEqual({ guestZoneTypes: DEFAULT_GUEST_ZONE_TYPES })
  })

  it('opens and closes a presence_sessions row', async () => {
    const store = createRoomStore(handle.db)
    const { orgId, userId, officeId } = await seed()
    const id = await store.startPresence(orgId, officeId, userId)
    const read = async () => (await handle.db.select().from(presenceSessions)).find((row) => row.id === id)
    expect(await read()).toMatchObject({ orgId, officeId, userId, leftAt: null })
    // Another company cannot close it.
    await store.endPresence((await seed()).orgId, id)
    expect((await read())?.leftAt).toBeNull()
    await store.endPresence(orgId, id)
    expect((await read())?.leftAt).toBeInstanceOf(Date)
  })
})
