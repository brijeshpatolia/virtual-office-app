import { FEET_OFFSET_Y, MSG, rejectReason } from '@vo/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadMap, seatState, startRoomServer, waitFor, withChanges, type RoomServer, type TestPlayer, type TestUser } from './harness.ts'

const ann: TestUser = { userId: 'u-ann', name: 'Ann', orgId: 'org-a' }
const ben: TestUser = { userId: 'u-ben', name: 'Ben', orgId: 'org-a' }
const gus: TestUser = { userId: 'u-gus', name: 'Gus', orgId: 'org-a' }

// Feet points. Seat m1 is at (336, 528) in the meeting room.
const MEETING_ROOM = { x: 368, y: 512 }
const toMeetingRoom = [{ x: 368, y: 368 }, MEETING_ROOM]

let rs: RoomServer
let office = 0
function newOffice(): string {
  const officeId = `office-${++office}`
  rs.grant(ann, officeId)
  rs.grant(ben, officeId)
  rs.grant(gus, officeId, 'guest')
  return officeId
}

beforeAll(async () => {
  const extra = { facing: 'left' as const, hasComputer: false, computer: null }
  const map = withChanges(await loadMap(), {
    seats: [
      // In the open plan, 46 px from a hallway spot on the other side of the wall.
      { id: 't1', zoneId: 'open-plan', x: 804, y: 464, ...extra },
      // In the open plan, 32 px from the open-plan door.
      { id: 't2', zoneId: 'open-plan', x: 816, y: 400, ...extra },
      // On the meeting table (furniture): the avatar stands up beside it.
      { id: 't3', zoneId: 'meeting-room', x: 400, y: 560, ...extra },
    ],
  })
  rs = await startRoomServer(map)
})
afterAll(() => rs.close())

async function sit(player: TestPlayer, seatId: unknown): Promise<unknown> {
  return player.room.request(MSG.sit, { seatId }).catch((error: unknown) => ({ rejected: rejectReason(error) }))
}

describe('OfficeRoom seats', () => {
  it('seats a player on a free seat in range; the others see it; stand and leave free it', async () => {
    const officeId = newOffice()
    const a = await rs.join(ann, officeId)
    const b = await rs.join(ben, officeId)
    await a.walk(...toMeetingRoom)
    expect(await sit(a, 'm1')).toEqual({ ok: true, seatId: 'm1', x: 336, y: 528 - FEET_OFFSET_Y, dir: 'down' })
    expect(a.server()).toMatchObject({ seatId: 'm1', x: 336, y: 516, dir: 'down', moving: false, zoneId: 'meeting-room' })
    await waitFor(() => seatState(b, 'm1') === 'u-ann', 'ben to see m1 taken')
    expect(b.room.state.players.get(a.sessionId)?.seatId).toBe('m1')

    // Seated players do not walk.
    expect(await a.moveTo({ x: 336, y: 500 })).toMatchObject({ reason: 'seated', x: 336, y: 516 })

    // Ben cannot take it.
    await b.walk(...toMeetingRoom)
    expect(await sit(b, 'm1')).toEqual({ rejected: 'taken' })

    // Standing up keeps Ann where she sat (the seat is free floor) and frees the seat.
    expect(await a.room.request(MSG.stand, {})).toEqual({ ok: true, x: 336, y: 516 })
    expect(a.server()).toMatchObject({ seatId: '', x: 336, y: 516 })
    await waitFor(() => seatState(b, 'm1') === '', 'ben to see m1 free')
    expect(await a.moveTo({ x: 336, y: 500 })).toBeNull()
    expect(await sit(b, 'm1')).toMatchObject({ ok: true, seatId: 'm1' })

    // Leaving frees the seat as well.
    await b.leave()
    await waitFor(() => seatState(a, 'm1') === '', 'ann to see m1 free after ben left')
    await a.leave()
  })

  it('answers where the avatar stands up when the seat itself is not free floor', async () => {
    const officeId = newOffice()
    const a = await rs.join(ann, officeId)
    await a.walk(...toMeetingRoom, { x: 400, y: 516 })
    expect(await sit(a, 't3')).toMatchObject({ ok: true, x: 400, y: 560 - FEET_OFFSET_Y })
    const stand = (await a.room.request(MSG.stand, {})) as { ok: true; x: number; y: number }
    expect(stand.y).not.toBe(560 - FEET_OFFSET_Y)
    expect(a.server()).toMatchObject({ seatId: '', x: stand.x, y: stand.y })
    // A walk from there passes.
    expect(await a.moveTo({ x: stand.x, y: stand.y + FEET_OFFSET_Y - 8 })).toBeNull()
    await a.leave()
  })

  it('rejects a seat that is out of range or behind a wall', async () => {
    const officeId = newOffice()
    const a = await rs.join(ann, officeId)
    expect(await sit(a, 'm1')).toEqual({ rejected: 'far' })
    await a.walk({ x: 752, y: 368 }, { x: 752, y: 464 }, { x: 758, y: 464 })
    // t1 is 46 px away, but the hallway wall is between them.
    expect(await sit(a, 't1')).toEqual({ rejected: 'far' })
    expect(a.server().seatId).toBe('')
    expect(seatState(a, 't1')).toBe('')
    await a.leave()
  })

  it('rejects unknown seats and bad payloads', async () => {
    const officeId = newOffice()
    const a = await rs.join(ann, officeId)
    expect(await sit(a, 'nope')).toEqual({ rejected: 'invalid' })
    expect(await sit(a, 42)).toEqual({ rejected: 'invalid' })
    expect(await a.room.request(MSG.sit, 'm1').catch(rejectReason)).toBe('invalid')
    expect(a.closeCode).toBeNull()
    await a.leave()
  })

  it('does not let a guest sit down in a zone they may not enter', async () => {
    const officeId = newOffice()
    const g = await rs.join(gus, officeId)
    const m = await rs.join(ann, officeId)
    const toDoor = [{ x: 752, y: 400 }, { x: 784, y: 400 }]
    await g.walk(...toDoor)
    expect(g.server().zoneId).toBe('')
    expect(await sit(g, 't2')).toEqual({ rejected: 'not_allowed' })
    await m.walk(...toDoor)
    expect(await sit(m, 't2')).toMatchObject({ ok: true, seatId: 't2' })
    expect(m.server().zoneId).toBe('open-plan')
    await Promise.all([g.leave(), m.leave()])
  })
})
