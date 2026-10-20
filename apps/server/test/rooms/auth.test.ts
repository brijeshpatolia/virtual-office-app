import { ErrorCode } from '@colyseus/core'
import { Client } from '@colyseus/sdk'
import { ROOM_NAME } from '@vo/shared'
import { generateKeyPair } from 'jose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadMap, startRoomServer, type RoomServer, type TestUser } from './harness.ts'

const ann: TestUser = { userId: 'u-ann', name: 'Ann', orgId: 'org-a' }
const ben: TestUser = { userId: 'u-ben', name: 'Ben', orgId: 'org-a' }
const zoe: TestUser = { userId: 'u-zoe', name: 'Zoe', orgId: 'org-b' }

let rs: RoomServer
beforeAll(async () => {
  rs = await startRoomServer(await loadMap())
  rs.grant(ann, 'office-a')
  rs.grant(ben, 'office-a')
  rs.grant(zoe, 'office-b')
})
afterAll(() => rs.close())

async function joinWith(token: string | undefined, options: unknown) {
  const client = new Client(rs.endpoint)
  if (token !== undefined) client.auth.token = token
  return client.joinOrCreate(ROOM_NAME, options as { officeId: string })
}

const unauthorized = { code: ErrorCode.AUTH_FAILED, message: 'unauthorized' }

describe('OfficeRoom join', () => {
  it('lets members in, one room per office', async () => {
    const a = await rs.join(ann, 'office-a')
    const b = await rs.join(ben, 'office-a')
    const z = await rs.join(zoe, 'office-b')
    expect(b.room.roomId).toBe(a.room.roomId)
    expect(z.room.roomId).not.toBe(a.room.roomId)
    expect([...a.serverState().players.values()].map((p) => p.userId).sort()).toEqual(['u-ann', 'u-ben'])
    expect([...z.serverState().players.values()].map((p) => p.userId)).toEqual(['u-zoe'])
    await Promise.all([a.leave(), b.leave(), z.leave()])
  })

  it("rejects another company's token for this office", async () => {
    // A valid token of company B, for its own office, used to join office A.
    await expect(joinWith(await rs.token(zoe, 'office-b'), { officeId: 'office-a' })).rejects.toMatchObject(unauthorized)
    // A signed token that names office A, for a user who is not a member of its company.
    await expect(joinWith(await rs.token(zoe, 'office-a'), { officeId: 'office-a' })).rejects.toMatchObject(unauthorized)
    // A member of office A whose token claims another company.
    const wrongOrg = await rs.token(ann, 'office-a', { orgId: 'org-b' })
    await expect(joinWith(wrongOrg, { officeId: 'office-a' })).rejects.toMatchObject(unauthorized)
  })

  it('rejects a missing, malformed, expired or foreign-signed token', async () => {
    await expect(joinWith(undefined, { officeId: 'office-a' })).rejects.toMatchObject(unauthorized)
    await expect(joinWith('not-a-jwt', { officeId: 'office-a' })).rejects.toMatchObject(unauthorized)
    const expired = await rs.token(ann, 'office-a', { expiresAt: Math.floor(Date.now() / 1000) - 60 })
    await expect(joinWith(expired, { officeId: 'office-a' })).rejects.toMatchObject(unauthorized)
    const { privateKey } = await generateKeyPair('EdDSA')
    const forged = await rs.token(ann, 'office-a', { key: privateKey })
    await expect(joinWith(forged, { officeId: 'office-a' })).rejects.toMatchObject(unauthorized)
  })

  it('rejects bad join options', async () => {
    const token = await rs.token(ann, 'office-a')
    await expect(joinWith(token, {})).rejects.toMatchObject(unauthorized)
    await expect(joinWith(token, { officeId: '' })).rejects.toMatchObject(unauthorized)
    await expect(joinWith(token, { officeId: 'x'.repeat(65) })).rejects.toMatchObject(unauthorized)
  })

  it('does not let a client pick a room by id or create a second room', async () => {
    const a = await rs.join(ann, 'office-a')
    const client = new Client(rs.endpoint)
    client.auth.token = await rs.token(zoe, 'office-b')
    await expect(client.joinById(a.room.roomId, { officeId: 'office-b' })).rejects.toThrow(/invalid method/)
    client.auth.token = await rs.token(ann, 'office-a')
    await expect(client.create(ROOM_NAME, { officeId: 'office-a' })).rejects.toThrow(/invalid method/)
    expect(a.serverState().players.size).toBe(1)
    await a.leave()
  })
})
