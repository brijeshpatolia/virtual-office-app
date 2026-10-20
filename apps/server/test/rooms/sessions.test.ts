import { CloseCode, matchMaker } from '@colyseus/core'
import { Callbacks } from '@colyseus/sdk'
import { AWAY_AFTER_MS, HIDDEN_AWAY_AFTER_MS, MAX_MESSAGES_PER_SECOND, MSG, ROOM_CLOSE } from '@vo/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ACCESS_RECHECK_MS } from '../../src/rooms/OfficeRoom.ts'
import { loadMap, seatState, sleep, startRoomServer, waitFor, type RoomServer, type TestPlayer, type TestUser } from './harness.ts'

const ann: TestUser = { userId: 'u-ann', name: 'Ann', orgId: 'org-a' }
const ben: TestUser = { userId: 'u-ben', name: 'Ben', orgId: 'org-a' }

const toMeetingRoom = [
  { x: 368, y: 368 },
  { x: 368, y: 512 },
]

let rs: RoomServer
let office = 0
function newOffice(): string {
  const officeId = `office-${++office}`
  rs.grant(ann, officeId)
  rs.grant(ben, officeId)
  return officeId
}

beforeAll(async () => {
  rs = await startRoomServer(await loadMap())
})
afterAll(() => rs.close())

const usersIn = (p: TestPlayer) => [...p.serverState().players.values()].map((player) => player.userId).sort()

// Closes the server side of the player's WebSocket without a close frame, like a network drop.
function dropConnection(p: TestPlayer): void {
  const client = matchMaker.getLocalRoomById(p.room.roomId).clients.find((c) => c.sessionId === p.sessionId)
  if (client === undefined) throw new Error('No server client')
  ;(client.ref as unknown as { terminate(): void }).terminate()
}

describe('OfficeRoom sessions', () => {
  it('replaces the older session when the same user joins again', async () => {
    const officeId = newOffice()
    const b = await rs.join(ben, officeId)
    const first = await rs.join(ann, officeId)
    await first.walk(...toMeetingRoom)
    await first.room.request(MSG.sit, { seatId: 'm1' })
    const second = await rs.join(ann, officeId)
    await waitFor(() => first.closeCode !== null, 'the first tab to close')
    expect(first.closeCode).toBe(ROOM_CLOSE.replaced)
    expect(usersIn(b)).toEqual(['u-ann', 'u-ben'])
    expect(second.server()).toMatchObject({ userId: 'u-ann', seatId: '', zoneId: 'lobby' })
    await waitFor(() => !b.room.state.players.has(first.sessionId) && b.room.state.players.has(second.sessionId), 'ben to see the new tab')
    expect(seatState(b, 'm1')).toBe('')
    // The SDK does not reconnect a replaced tab.
    await sleep(300)
    expect(usersIn(b)).toEqual(['u-ann', 'u-ben'])
    await Promise.all([b.leave(), second.leave()])
  })

  it('keeps a dropped player, with its seat, while it reconnects', async () => {
    const officeId = newOffice()
    const a = await rs.join(ann, officeId)
    const b = await rs.join(ben, officeId)
    await a.walk(...toMeetingRoom)
    await a.room.request(MSG.sit, { seatId: 'm1' })
    let removed = 0
    Callbacks.get(b.room).onRemove('players', () => removed++)
    a.room.reconnection.minUptime = 0
    const sessionId = a.sessionId
    const reconnected = new Promise<void>((resolve) => a.room.onReconnect(() => resolve()))
    dropConnection(a)
    await reconnected
    expect(a.sessionId).toBe(sessionId)
    expect(a.server()).toMatchObject({ userId: 'u-ann', seatId: 'm1', x: 336, y: 516 })
    expect(seatState(b, 'm1')).toBe('u-ann')
    expect(removed).toBe(0)
    expect(await a.room.request(MSG.stand, {})).toEqual({ ok: true, x: 336, y: 516 })
    expect(await a.moveTo({ x: 336, y: 500 })).toBeNull()
    await Promise.all([a.leave(), b.leave()])
  })

  it('lets a new tab take over a dropped session that waits for its reconnection', async () => {
    const officeId = newOffice()
    const b = await rs.join(ben, officeId)
    const first = await rs.join(ann, officeId)
    await first.walk(...toMeetingRoom)
    await first.room.request(MSG.sit, { seatId: 'm1' })
    first.room.reconnection.enabled = false
    dropConnection(first)
    await sleep(200)
    expect(b.serverState().players.has(first.sessionId)).toBe(true)
    const second = await rs.join(ann, officeId)
    expect(b.serverState().players.has(first.sessionId)).toBe(false)
    expect(usersIn(b)).toEqual(['u-ann', 'u-ben'])
    await waitFor(() => seatState(b, 'm1') === '', 'ben to see m1 free')
    await Promise.all([b.leave(), second.leave()])
  })

  it('removes at once a client that Colyseus closed for sending too many messages', async () => {
    const officeId = newOffice()
    const a = await rs.join(ann, officeId)
    const b = await rs.join(ben, officeId)
    for (let i = 0; i < MAX_MESSAGES_PER_SECOND + 10; i++) a.room.send(MSG.activity, { hidden: false })
    await waitFor(() => a.closeCode !== null, 'ann to be closed')
    expect(a.closeCode).toBe(CloseCode.WITH_ERROR)
    // The SDK does not reconnect after 4002, so the room keeps no ghost for RECONNECT_SECONDS.
    await waitFor(() => !b.room.state.players.has(a.sessionId), 'ben to see ann go', 1000)
    expect(usersIn(b)).toEqual(['u-ben'])
    await b.leave()
  })

  it('records presence_sessions rows for joins and leaves', async () => {
    const officeId = newOffice()
    const a = await rs.join(ann, officeId)
    const row = rs.store.started.find((r) => r.officeId === officeId)
    expect(row).toMatchObject({ orgId: 'org-a', officeId, userId: 'u-ann' })
    expect(rs.store.ended.some((r) => r.presenceId === row?.id)).toBe(false)
    await a.leave()
    await waitFor(() => rs.store.ended.some((r) => r.presenceId === row?.id && r.orgId === 'org-a'), 'the row to close')
  })

  it('marks idle and hidden players away, and available again on activity', async () => {
    const officeId = newOffice()
    const a = await rs.join(ann, officeId)
    rs.clock.advance(AWAY_AFTER_MS)
    await waitFor(() => a.server().status === 'away', 'away after idling')
    a.room.send(MSG.activity, { hidden: false })
    await waitFor(() => a.server().status === 'available', 'available after activity')

    a.room.send(MSG.activity, { hidden: true })
    await sleep(100)
    rs.clock.advance(HIDDEN_AWAY_AFTER_MS - 60_000)
    await sleep(1200)
    expect(a.server().status).toBe('available')
    rs.clock.advance(60_000)
    await waitFor(() => a.server().status === 'away', 'away with the tab hidden')

    await a.walk({ x: 600, y: 368 })
    expect(a.server().status).toBe('available')
    await waitFor(() => a.room.state.players.get(a.sessionId)?.status === 'available', 'the client to see it')
    await a.leave()
  })

  it('closes the session of a user who lost access to the office', async () => {
    const officeId = newOffice()
    const a = await rs.join(ann, officeId)
    const b = await rs.join(ben, officeId)
    rs.revoke(ann, officeId)
    rs.grant(ben, officeId, 'guest')
    rs.clock.advance(ACCESS_RECHECK_MS)
    await waitFor(() => a.closeCode !== null, 'ann to be closed')
    expect(a.closeCode).toBe(ROOM_CLOSE.removed)
    await waitFor(() => !b.room.state.players.has(a.sessionId), 'ben to see ann leave')
    expect(usersIn(b)).toEqual(['u-ben'])
    // Ben's page is told his new role.
    await waitFor(() => b.received(MSG.roleChanged).length === 1, 'role:changed')
    expect(b.received(MSG.roleChanged)).toEqual([{ role: 'guest' }])
    // Ben is a guest now: the hallway is closed to him.
    await b.walk({ x: 752, y: 400 })
    expect(await b.moveTo({ x: 752, y: 440 })).toMatchObject({ reason: 'guest' })
    expect(b.closeCode).toBeNull()
    await b.leave()
  })

  it('tells a reconnected client the role change it missed while the connection was down', async () => {
    const officeId = newOffice()
    const a = await rs.join(ann, officeId)
    a.room.reconnection.minUptime = 0
    a.room.reconnection.minDelay = 1000
    a.room.reconnection.maxDelay = 1000
    const reconnected = new Promise<void>((resolve) => a.room.onReconnect(() => resolve()))
    dropConnection(a)
    await sleep(100)
    rs.grant(ann, officeId, 'admin')
    rs.clock.advance(ACCESS_RECHECK_MS)
    await sleep(300)
    expect(a.received(MSG.roleChanged)).toEqual([])
    await reconnected
    await waitFor(() => a.received(MSG.roleChanged).length === 1, 'role:changed after the reconnect')
    expect(a.received(MSG.roleChanged)).toEqual([{ role: 'admin' }])
    rs.grant(ann, officeId, 'member')
    await a.leave()
  })

  it('sends a member who becomes a guest inside a members-only zone back to the door', async () => {
    const officeId = newOffice()
    const a = await rs.join(ann, officeId)
    const b = await rs.join(ben, officeId)
    await b.walk({ x: 752, y: 400 }, { x: 816, y: 400 }, { x: 880, y: 464 })
    expect(b.server().zoneId).toBe('open-plan')
    rs.grant(ben, officeId, 'guest')
    rs.clock.advance(ACCESS_RECHECK_MS)
    await waitFor(() => b.closeCode !== null, 'ben to be closed')
    expect(b.closeCode).toBe(ROOM_CLOSE.roleChanged)
    await waitFor(() => !a.room.state.players.has(b.sessionId), 'ann to see ben go')
    // He enters again at the spawn, as a guest.
    const again = await rs.join(ben, officeId)
    expect(again.server().zoneId).toBe('lobby')
    expect(await again.walk({ x: 752, y: 400 }, { x: 784, y: 400 }).then(() => again.moveTo({ x: 816, y: 400 }))).toMatchObject({ reason: 'guest' })
    await Promise.all([a.leave(), again.leave()])
  })
})
