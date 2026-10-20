import { AWAY_AFTER_MS, MSG, WAVE_RATE_LIMIT, type WaveReceived } from '@vo/shared'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { startChatDb, type ChatTestDb, type Member } from '../chat/fixtures.ts'
import { loadMap, sleep, startRoomServer, waitFor, type RoomServer, type TestPlayer } from '../rooms/harness.ts'

// status:set, the effective status, waves and block:set in the office room.
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

async function office() {
  const company = await t.company(`Presence${++companies}`)
  const people: Member[] = []
  for (const name of ['Ann', 'Ben', 'Cy', 'Dee']) {
    const m = await company.join(name)
    rs.grant(m, company.officeId)
    people.push(m)
  }
  const [ann, ben, cy, dee] = people as [Member, Member, Member, Member]
  return { orgId: company.orgId, ann, ben, cy, dee, join: (m: Member) => rs.join(m, company.officeId) }
}

const rejected = (reason: string) => ({ name: 'rejected', reason })
const setStatus = (p: TestPlayer, request: Record<string, unknown>) => p.room.request(MSG.statusSet, request)
const waves = (p: TestPlayer) => p.received<WaveReceived>(MSG.waveReceived)
const toMeetingRoom = [
  { x: 368, y: 368 },
  { x: 368, y: 512 },
]

describe('status:set', () => {
  it('sets the chosen status and the status text, and saves the text when it changes', async () => {
    const { orgId, ann, ben, join } = await office()
    const a = await join(ann)
    const b = await join(ben)
    const update = vi.spyOn(t.services.prefs, 'update')
    try {
      expect(await setStatus(a, { status: 'busy', statusText: '  In a call  ' })).toEqual({ ok: true, status: 'busy', statusText: 'In a call' })
      expect(a.server()).toMatchObject({ status: 'busy', chosenStatus: 'busy', statusText: 'In a call' })
      await waitFor(() => b.room.state.players.get(a.sessionId)?.statusText === 'In a call', 'ben to see the text')
      await vi.waitFor(async () => expect((await t.services.prefs.get(orgId, ann.userId)).statusText).toBe('In a call'))

      expect(await setStatus(a, { status: 'dnd' })).toEqual({ ok: true, status: 'dnd', statusText: 'In a call' })
      expect(await setStatus(a, { status: 'dnd', statusText: 'In a call' })).toMatchObject({ ok: true })
      for (const bad of [{ status: 'busy', statusText: 'x'.repeat(81) }, { status: 'busy', statusText: 'two\nlines' }, { status: 'away' }, {}]) {
        await expect(setStatus(a, bad)).rejects.toMatchObject(rejected('invalid'))
      }
      expect(a.server()).toMatchObject({ status: 'dnd', chosenStatus: 'dnd', statusText: 'In a call' })
      await sleep(100)
      expect(update).toHaveBeenCalledTimes(1)

      // A burst of changes: the first is written at once, the rest as one write with the last text.
      for (const text of ['t1', 't2', 't3', 't4', 't5']) await setStatus(a, { status: 'dnd', statusText: text })
      await vi.waitFor(async () => expect((await t.services.prefs.get(orgId, ann.userId)).statusText).toBe('t5'), { timeout: 3000 })
      expect(update.mock.calls.length).toBeLessThanOrEqual(3)
      expect(a.server().statusText).toBe('t5')
    } finally {
      update.mockRestore()
    }
    await Promise.all([a.leave(), b.leave()])
  })

  it('loads the saved status text at join and shows a change made elsewhere at once', async () => {
    const { orgId, ann, join } = await office()
    await t.services.prefs.update(orgId, ann.userId, { statusText: 'Lunch' })
    const a = await join(ann)
    expect(a.server()).toMatchObject({ statusText: 'Lunch', status: 'available', chosenStatus: 'available' })
    await t.services.prefs.update(orgId, ann.userId, { statusText: 'Back at 3' })
    await waitFor(() => a.server().statusText === 'Back at 3', 'the new text')

    // The chosen status lasts for the session; a new join starts at available with the saved text.
    await setStatus(a, { status: 'dnd' })
    await a.leave()
    const again = await join(ann)
    expect(again.server()).toMatchObject({ statusText: 'Back at 3', status: 'available', chosenStatus: 'available' })
    await again.leave()
  })

  it('shows the newest status text after a quick leave and rejoin, while a write still waits', async () => {
    const { orgId, ann, ben, join } = await office()
    const b = await join(ben)
    const a = await join(ann)
    await setStatus(a, { status: 'available', statusText: 'A' })
    await sleep(50)
    await setStatus(a, { status: 'available', statusText: 'B' })
    await a.leave()
    const again = await join(ann)
    expect(again.server().statusText).toBe('B')
    await waitFor(() => b.room.state.players.get(again.sessionId)?.statusText === 'B', 'ben to see B')
    expect((await t.services.prefs.get(orgId, ann.userId)).statusText).toBe('B')
    await Promise.all([again.leave(), b.leave()])
  })

  it('shows busy in a meeting room unless on DND, and away after idling', async () => {
    const { ann, join } = await office()
    const a = await join(ann)
    await a.walk(...toMeetingRoom)
    expect(a.server()).toMatchObject({ zoneId: 'meeting-room', status: 'busy', chosenStatus: 'available' })
    await setStatus(a, { status: 'dnd' })
    expect(a.server().status).toBe('dnd')
    await setStatus(a, { status: 'available' })
    expect(a.server().status).toBe('busy')
    await a.walk({ x: 368, y: 368 })
    expect(a.server()).toMatchObject({ zoneId: 'lobby', status: 'available' })

    await setStatus(a, { status: 'busy' })
    rs.clock.advance(AWAY_AFTER_MS)
    await waitFor(() => a.server().status === 'away', 'away after idling')
    expect(a.server().chosenStatus).toBe('busy')
    a.room.send(MSG.activity, { hidden: false })
    await waitFor(() => a.server().status === 'busy', 'busy again')
    await setStatus(a, { status: 'dnd' })
    rs.clock.advance(AWAY_AFTER_MS)
    await sleep(1200)
    expect(a.server().status).toBe('dnd')
    await waitFor(() => a.room.state.players.get(a.sessionId)?.status === 'dnd', 'the client to see it')
    await a.leave()
  })
})

describe('wave', () => {
  it("delivers a wave only to its target, with the sender's name", async () => {
    const { ann, ben, cy, join } = await office()
    const [a, b, c] = await Promise.all([join(ann), join(ben), join(cy)])
    a.room.send(MSG.wave, { targetUserId: ben.userId })
    await waitFor(() => waves(b).length === 1, 'the wave')
    expect(waves(b)).toEqual([{ fromUserId: ann.userId, fromName: 'Ann' }])
    await sleep(100)
    expect(waves(a)).toEqual([])
    expect(waves(c)).toEqual([])
    await Promise.all([a.leave(), b.leave(), c.leave()])
  })

  it('drops waves to DND, across a block either way, to yourself and to people not in the room', async () => {
    const { ann, ben, dee, join } = await office()
    const [a, b] = await Promise.all([join(ann), join(ben)])
    const wave = (from: TestPlayer, to: Member) => from.room.send(MSG.wave, { targetUserId: to.userId })

    await setStatus(b, { status: 'dnd' })
    wave(a, ben)
    wave(a, ann)
    wave(a, dee)
    a.room.send(MSG.wave, { targetUserId: '' })
    await sleep(150)
    expect(waves(b)).toEqual([])
    expect(waves(a)).toEqual([])
    await setStatus(b, { status: 'available' })
    wave(a, ben)
    await waitFor(() => waves(b).length === 1, 'the wave after DND')

    expect(await b.room.request(MSG.blockSet, { userId: ann.userId, blocked: true })).toEqual({ ok: true, blockedUserIds: [ann.userId] })
    rs.clock.advance(WAVE_RATE_LIMIT.windowMs)
    wave(a, ben)
    wave(b, ann)
    await sleep(150)
    expect(waves(b)).toHaveLength(1)
    expect(waves(a)).toEqual([])
    expect(await b.room.request(MSG.blockSet, { userId: ann.userId, blocked: false })).toEqual({ ok: true, blockedUserIds: [] })
    rs.clock.advance(WAVE_RATE_LIMIT.windowMs)
    wave(a, ben)
    wave(b, ann)
    await waitFor(() => waves(b).length === 2 && waves(a).length === 1, 'waves after the unblock')
    await Promise.all([a.leave(), b.leave()])
  })

  it(`allows one wave per target per 10 s and ${WAVE_RATE_LIMIT.waves} per 30 s`, async () => {
    const { ann, ben, cy, dee, join } = await office()
    const [a, b, c, d] = await Promise.all([join(ann), join(ben), join(cy), join(dee)])
    const wave = (to: Member) => a.room.send(MSG.wave, { targetUserId: to.userId })
    wave(ben)
    wave(ben)
    await waitFor(() => waves(b).length === 1, 'the first wave')
    await sleep(100)
    expect(waves(b)).toHaveLength(1)
    rs.clock.advance(WAVE_RATE_LIMIT.perTargetMs)
    wave(ben)
    wave(cy)
    await waitFor(() => waves(b).length === 2 && waves(c).length === 1, 'two more waves')
    // The fourth wave within 30 s.
    wave(dee)
    await sleep(150)
    expect(waves(d)).toEqual([])
    rs.clock.advance(WAVE_RATE_LIMIT.windowMs - WAVE_RATE_LIMIT.perTargetMs)
    wave(dee)
    await waitFor(() => waves(d).length === 1, 'the wave after the window')
    await Promise.all([a.leave(), b.leave(), c.leave(), d.leave()])
  })
})

describe('block:set', () => {
  it('blocks current members only, never yourself, and unblocks anyone', async () => {
    const { orgId, ann, ben, join } = await office()
    const a = await join(ann)
    const outsider = await (await t.company('Elsewhere')).join('Eve')
    await expect(a.room.request(MSG.blockSet, { userId: ann.userId, blocked: true })).rejects.toMatchObject(rejected('invalid'))
    await expect(a.room.request(MSG.blockSet, { userId: outsider.userId, blocked: true })).rejects.toMatchObject(rejected('not_found'))
    await expect(a.room.request(MSG.blockSet, { userId: ben.userId })).rejects.toMatchObject(rejected('invalid'))
    expect(await a.room.request(MSG.blockSet, { userId: outsider.userId, blocked: false })).toEqual({ ok: true, blockedUserIds: [] })
    expect(await a.room.request(MSG.blockSet, { userId: ben.userId, blocked: true })).toEqual({ ok: true, blockedUserIds: [ben.userId] })
    expect((await t.services.prefs.get(orgId, ann.userId)).blockedUserIds).toEqual([ben.userId])
    await a.leave()
  })
})
