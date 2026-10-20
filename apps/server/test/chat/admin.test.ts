import { auditLog, forOrg } from '@vo/db'
import { MSG, ROOM_CLOSE, type ChatMuted, type OrgRole } from '@vo/shared'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadMap, sleep, startRoomServer, waitFor, type RoomServer, type TestPlayer } from '../rooms/harness.ts'
import { startChatDb, type ChatTestDb, type Member } from './fixtures.ts'

// admin:mute and admin:kick in the office room.
let t: ChatTestDb
let rs: RoomServer
let companies = 0

beforeAll(async () => {
  t = await startChatDb()
  rs = await startRoomServer(await loadMap(), { services: t.services })
})
afterAll(async () => {
  await rs.close()
  await t.close()
})

const ROLES: [string, OrgRole][] = [
  ['Olga', 'owner'],
  ['Ada', 'admin'],
  ['Ben', 'member'],
  ['Gus', 'guest'],
]

async function office() {
  const company = await t.company(`Admin${++companies}`)
  const people: Member[] = []
  for (const [name, role] of ROLES) {
    const m = await company.join(name, role)
    rs.grant(m, company.officeId, role)
    people.push(m)
  }
  const [olga, ada, ben, gus] = people as [Member, Member, Member, Member]
  return { company, olga, ada, ben, gus, join: (m: Member) => rs.join(m, company.officeId) }
}

const rejected = (reason: string) => ({ name: 'rejected', reason })
const say = (p: TestPlayer, body: string) => p.room.request(MSG.chatSend, { clientMsgId: randomUUID(), body })
const usersIn = (p: TestPlayer) => [...p.serverState().players.values()].map((player) => player.userId)

describe('admin:mute', () => {
  it('lets owners and admins mute lower roles, and tells the muted user until when', async () => {
    const { company, olga, ada, ben, join } = await office()
    const [o, d, b] = await Promise.all([join(olga), join(ada), join(ben)])
    await expect(b.room.request(MSG.adminMute, { userId: ada.userId, minutes: 15 })).rejects.toMatchObject(rejected('not_allowed'))
    await expect(d.room.request(MSG.adminMute, { userId: olga.userId, minutes: 15 })).rejects.toMatchObject(rejected('not_allowed'))
    await expect(d.room.request(MSG.adminMute, { userId: 'nobody', minutes: 15 })).rejects.toMatchObject(rejected('not_found'))
    await expect(d.room.request(MSG.adminMute, { userId: ben.userId, minutes: -1 })).rejects.toMatchObject(rejected('invalid'))

    const until = new Date(t.clock.ms + 15 * 60_000).toISOString()
    expect(await d.room.request(MSG.adminMute, { userId: ben.userId, minutes: 15 })).toEqual({ ok: true, until })
    await waitFor(() => b.received(MSG.chatMuted).length === 1, 'chat:muted')
    expect(b.received<ChatMuted>(MSG.chatMuted)).toEqual([{ until }])
    await expect(say(b, 'can I talk?')).rejects.toMatchObject(rejected('muted'))
    // The rejection comes with the end of the mute, for a client that joined after it started.
    await waitFor(() => b.received(MSG.chatMuted).length === 2, 'chat:muted with the rejection')

    expect(await o.room.request(MSG.adminMute, { userId: ben.userId, minutes: 0 })).toEqual({ ok: true, until: null })
    await waitFor(() => b.received(MSG.chatMuted).length === 3, 'chat:muted null')
    expect(b.received<ChatMuted>(MSG.chatMuted).at(-1)).toEqual({ until: null })
    expect(await say(b, 'thanks')).toMatchObject({ ok: true })

    const actions = (await t.handle.db.select().from(auditLog)).filter((e) => e.orgId === company.orgId).map((e) => [e.action, e.actorId])
    expect(actions).toEqual([
      ['chat.mute', ada.userId],
      ['chat.unmute', olga.userId],
    ])
    await Promise.all([o.leave(), d.leave(), b.leave()])
  })

  it('mutes the whole company, also someone who is not in the room', async () => {
    const { ada, gus, join } = await office()
    const d = await join(ada)
    expect(await d.room.request(MSG.adminMute, { userId: gus.userId, minutes: 60 })).toMatchObject({ ok: true })
    const g = await join(gus)
    await expect(say(g, 'hello')).rejects.toMatchObject(rejected('muted'))
    await Promise.all([d.leave(), g.leave()])
  })
})

describe('admin:kick', () => {
  it('sends a lower role out of the office with 4103; the membership stays and they can come back', async () => {
    const { company, olga, ada, ben, gus, join } = await office()
    const [o, d, b] = await Promise.all([join(olga), join(ada), join(ben)])
    await expect(b.room.request(MSG.adminKick, { userId: ada.userId })).rejects.toMatchObject(rejected('not_allowed'))
    await expect(d.room.request(MSG.adminKick, { userId: olga.userId })).rejects.toMatchObject(rejected('not_allowed'))
    await expect(d.room.request(MSG.adminKick, { userId: ada.userId })).rejects.toMatchObject(rejected('not_allowed'))
    // Gus is a member of the company but not in the office.
    await expect(d.room.request(MSG.adminKick, { userId: gus.userId })).rejects.toMatchObject(rejected('not_found'))
    await expect(d.room.request(MSG.adminKick, { userId: 'nobody' })).rejects.toMatchObject(rejected('not_found'))

    expect(await d.room.request(MSG.adminKick, { userId: ben.userId })).toEqual({ ok: true })
    await waitFor(() => b.closeCode !== null, 'ben to be closed')
    expect(b.closeCode).toBe(ROOM_CLOSE.kicked)
    await waitFor(() => !o.room.state.players.has(b.sessionId), 'olga to see ben go')
    // The SDK does not reconnect after 4103.
    await sleep(300)
    expect(usersIn(o).sort()).toEqual([olga.userId, ada.userId].sort())

    expect(await forOrg(t.handle.db, company.orgId).findMember(ben.userId)).not.toBeNull()
    const back = await join(ben)
    expect(usersIn(o)).toContain(ben.userId)
    expect(await o.room.request(MSG.adminKick, { userId: ada.userId })).toEqual({ ok: true })
    await waitFor(() => d.closeCode === ROOM_CLOSE.kicked, 'ada to be closed')

    const entries = (await t.handle.db.select().from(auditLog)).filter((e) => e.orgId === company.orgId)
    expect(entries.map((e) => [e.action, e.actorId, e.targetId, e.data])).toEqual([
      ['office.kick', ada.userId, ben.userId, { officeId: company.officeId }],
      ['office.kick', olga.userId, ada.userId, { officeId: company.officeId }],
    ])
    await Promise.all([o.leave(), back.leave()])
  })
})
