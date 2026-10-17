import { FEET_OFFSET_Y, MSG } from '@vo/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadMap, sleep, startRoomServer, waitFor, withChanges, type RoomServer, type TestUser } from './harness.ts'

const ann: TestUser = { userId: 'u-ann', name: 'Ann', orgId: 'org-a' }
const ben: TestUser = { userId: 'u-ben', name: 'Ben', orgId: 'org-a' }
const gus: TestUser = { userId: 'u-gus', name: 'Gus', orgId: 'org-a' }

// Feet points on the office map (32 px tiles).
const SPAWN = { x: 528, y: 368 }
const LOBBY_EAST = { x: 752, y: 368 }
const HALLWAY = { x: 752, y: 464 }
const OPEN_PLAN = { x: 816, y: 464 }
const DOOR_ROW = 400
const PRIVATE_DOOR = { x: 688, y: 288 }
const PRIVATE_OFFICE = { x: 688, y: 248 }
const MEETING_DOOR = { x: 368, y: 464 }
const MEETING_ROOM = { x: 368, y: 512 }

let rs: RoomServer
let office = 0
// A fresh office (and so a fresh room) per test; ann and ben are members, gus is a guest.
function newOffice(): string {
  const officeId = `office-${++office}`
  rs.grant(ann, officeId)
  rs.grant(ben, officeId)
  rs.grant(gus, officeId, 'guest')
  return officeId
}

beforeAll(async () => {
  // Two diagonal wall cells in the open plan (corner cut), and a meeting room for one person.
  const map = withChanges(await loadMap(), {
    walls: [
      [28, 11],
      [29, 12],
    ],
    capacity: { 'meeting-room': 1 },
  })
  rs = await startRoomServer(map)
})
afterAll(() => rs.close())

describe('OfficeRoom moves', () => {
  it('spawns players a few px apart at the main spawn, in the lobby', async () => {
    const officeId = newOffice()
    const a = await rs.join(ann, officeId)
    const b = await rs.join(ben, officeId)
    for (const p of [a, b]) {
      expect(Math.hypot(p.feet().x - SPAWN.x, p.feet().y - SPAWN.y)).toBeLessThanOrEqual(17)
      expect(p.server()).toMatchObject({ zoneId: 'lobby', seatId: '', dir: 'down', moving: false, status: 'available' })
      expect(p.server().color).toMatch(/^#[0-9a-f]{6}$/)
    }
    expect(a.feet()).not.toEqual(b.feet())
    await Promise.all([a.leave(), b.leave()])
  })

  it('shows each player join, move and leave to the others', async () => {
    const officeId = newOffice()
    const a = await rs.join(ann, officeId)
    const b = await rs.join(ben, officeId)
    await waitFor(() => a.room.state.players.has(b.sessionId), 'ann to see ben')
    expect(a.room.state.players.get(b.sessionId)).toMatchObject({ userId: 'u-ben', name: 'Ben' })
    await b.walk({ x: 640, y: 368 })
    await waitFor(() => a.room.state.players.get(b.sessionId)?.x === 640, "ann to see ben's move")
    expect(a.room.state.players.get(b.sessionId)?.y).toBe(368 - FEET_OFFSET_Y)
    await b.leave()
    await waitFor(() => !a.room.state.players.has(b.sessionId), 'ann to see ben leave')
    await a.leave()
  })

  it('rejects a move through a wall and leaves the player where it was', async () => {
    const officeId = newOffice()
    const a = await rs.join(ann, officeId)
    const b = await rs.join(ben, officeId)
    await a.walk(LOBBY_EAST, HALLWAY)
    expect(a.server().zoneId).toBe('hallway')
    // The hallway and the open plan are one wall apart; both cells are free.
    const reject = await a.moveTo(OPEN_PLAN)
    expect(reject).toMatchObject({ reason: 'collision', x: HALLWAY.x, y: HALLWAY.y - FEET_OFFSET_Y })
    expect(a.feet()).toEqual(HALLWAY)
    await sleep(150)
    expect(b.room.state.players.get(a.sessionId)).toMatchObject({ x: HALLWAY.x, y: HALLWAY.y - FEET_OFFSET_Y })
    // Into furniture: the lobby desk north-west of the spawn.
    await a.walk(LOBBY_EAST, SPAWN)
    expect(await a.moveTo({ x: 496, y: 336 })).toMatchObject({ reason: 'collision' })
    await Promise.all([a.leave(), b.leave()])
  })

  it('rejects a diagonal that cuts between two diagonal wall cells', async () => {
    const officeId = newOffice()
    const a = await rs.join(ann, officeId)
    await a.walk({ x: 752, y: DOOR_ROW }, { x: 816, y: DOOR_ROW }, { x: 912, y: DOOR_ROW })
    expect(a.server().zoneId).toBe('open-plan')
    // From cell (28,12) to (29,11) through the shared corner of the walls (28,11) and (29,12).
    expect(await a.moveTo({ x: 944, y: 368 })).toMatchObject({ reason: 'collision', x: 912, y: DOOR_ROW - FEET_OFFSET_Y })
    // The same diagonal past two free cells is fine.
    expect(await a.moveTo({ x: 880, y: 432 })).toBeNull()
    await a.leave()
  })

  it('rejects a speed hack: one long jump, or many small moves that add up', async () => {
    const officeId = newOffice()
    const a = await rs.join(ann, officeId)
    await a.walk(SPAWN)
    expect(await a.moveTo({ x: SPAWN.x + 200, y: SPAWN.y })).toMatchObject({ reason: 'speed', x: SPAWN.x })
    await a.walk({ x: 208, y: 368 })
    // 20 px every 50 ms passes the per-move check (30 px) but is 400 px/s.
    let accepted = 0
    let reason: string | undefined
    for (let i = 1; i <= 30 && reason === undefined; i++) {
      const reject = await a.moveTo({ x: 208 + 20 * i, y: 368 }, 50)
      if (reject === null) accepted++
      else reason = reject.reason
    }
    expect(reason).toBe('speed')
    // Walking at full speed leaves 160 px of budget; each of these moves then costs 10 px net.
    expect(accepted).toBe(16)
    await a.leave()
  })

  it('drops moves above the rate limit and ignores invalid ones', async () => {
    const officeId = newOffice()
    const a = await rs.join(ann, officeId)
    const start = a.server()
    const x0 = start.x
    const y0 = start.y
    for (let seq = 1; seq <= 30; seq++) a.room.send(MSG.move, { x: x0 + seq * 0.5, y: y0, dir: 'right', moving: true, seq })
    a.room.send(MSG.move, { x: 'far', y: y0, dir: 'right', moving: true, seq: 31 })
    a.room.send(MSG.move, { x: x0, y: y0, dir: 'sideways', moving: true, seq: 32 })
    await waitFor(() => Math.abs(a.server().x - (x0 + 10)) < 0.01, 'the first 20 moves')
    await sleep(100)
    expect(a.server().x).toBeCloseTo(x0 + 10)
    expect(a.rejects).toEqual([])
    // A second later the limit has refilled.
    expect(await a.moveTo({ x: x0 + 12, y: y0 + FEET_OFFSET_Y }, 1000)).toBeNull()
    expect(a.server().dir).toBe('down')
    expect(a.closeCode).toBeNull()
    await a.leave()
  })

  it('keeps guests to the lobby and meeting zones', async () => {
    const officeId = newOffice()
    const g = await rs.join(gus, officeId)
    const m = await rs.join(ann, officeId)
    await g.walk({ x: PRIVATE_DOOR.x, y: 368 }, PRIVATE_DOOR)
    expect(g.server().zoneId).toBe('')
    expect(await g.moveTo(PRIVATE_OFFICE)).toMatchObject({
      reason: 'guest',
      x: PRIVATE_DOOR.x,
      y: PRIVATE_DOOR.y - FEET_OFFSET_Y,
    })
    await m.walk({ x: PRIVATE_DOOR.x, y: 368 }, PRIVATE_DOOR, PRIVATE_OFFICE)
    expect(m.server().zoneId).toBe('private-office')
    // The hallway touches the lobby without a door.
    await g.walk({ x: PRIVATE_DOOR.x, y: 368 }, { x: 752, y: 400 })
    expect(await g.moveTo({ x: 752, y: 440 })).toMatchObject({ reason: 'guest' })
    await g.walk({ x: MEETING_DOOR.x, y: 400 }, MEETING_DOOR, MEETING_ROOM)
    expect(g.server().zoneId).toBe('meeting-room')
    await Promise.all([g.leave(), m.leave()])
  })

  it('takes the guest zones from the office settings', async () => {
    const officeId = newOffice()
    rs.store.settings.set(officeId, { guestZoneTypes: ['lobby', 'meeting', 'hallway'] })
    const g = await rs.join(gus, officeId)
    await g.walk({ x: 752, y: 400 }, HALLWAY)
    expect(g.server().zoneId).toBe('hallway')
    await g.leave()
  })

  it('keeps people out of a full room-mode zone', async () => {
    const officeId = newOffice()
    const a = await rs.join(ann, officeId)
    const b = await rs.join(ben, officeId)
    await a.walk({ x: MEETING_ROOM.x, y: 368 }, MEETING_ROOM)
    expect(a.server().zoneId).toBe('meeting-room')
    await b.walk({ x: MEETING_DOOR.x, y: 368 }, MEETING_DOOR)
    expect(b.server().zoneId).toBe('')
    expect(await b.moveTo(MEETING_ROOM)).toMatchObject({ reason: 'full', x: MEETING_DOOR.x })
    await a.walk({ x: MEETING_ROOM.x, y: 368 })
    expect(a.server().zoneId).toBe('lobby')
    expect(await b.moveTo(MEETING_ROOM)).toBeNull()
    expect(b.server().zoneId).toBe('meeting-room')
    await Promise.all([a.leave(), b.leave()])
  })
})
