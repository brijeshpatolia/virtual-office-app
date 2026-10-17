import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildGrid, type Grid } from '../src/grid.ts'
import {
  checkMove,
  fullMoveBudget,
  maxMoveDistance,
  MOVE_BUDGET_PX,
  MOVE_CHECK_BODY,
  nearestFreeStandSpot,
  speedAllowed,
  spendMoveBudget,
  sweptSegmentBlocked,
  zoneEntryBlock,
  type MoveBudget,
} from '../src/movement.ts'
import { parseOfficeMap } from '../src/officeMap.ts'
import { PLAYER_BODY } from '../src/protocol/constants.ts'
import type { ColliderDef, OfficeMap, Point, SeatDef, ZoneDef } from '../src/types.ts'

const T = 32
const OFFSET = PLAYER_BODY.offsetY

// '#' wall, 'f' furniture, '.' free. Both kinds block walking.
function walkGridFrom(rows: string[]): Grid {
  const colliders: ColliderDef[] = []
  rows.forEach((line, row) => {
    ;[...line].forEach((ch, col) => {
      const rect = { x: col * T, y: row * T, w: T, h: T }
      if (ch === '#') colliders.push({ name: '', kind: 'wall', rect })
      if (ch === 'f') colliders.push({ name: '', kind: 'furniture', rect })
    })
  })
  const map = { width: rows[0]?.length ?? 0, height: rows.length, tileWidth: T, tileHeight: T, colliders }
  return buildGrid(map, ['wall', 'furniture'])
}

// Sprite-centre position whose feet point is (fx, fy).
const at = (fx: number, fy: number): Point => ({ x: fx, y: fy - OFFSET })
// Sprite-centre position whose feet point is the centre of the cell.
const cell = (col: number, row: number): Point => at(col * T + T / 2, row * T + T / 2)

const open = walkGridFrom(['.....', '.....', '.....', '.....', '.....'])

describe('maxMoveDistance and speedAllowed', () => {
  it('allows MAX_SPEED x SPEED_CAP over the elapsed time plus the jitter allowance', () => {
    expect(maxMoveDistance(0)).toBeCloseTo(20)
    expect(maxMoveDistance(100)).toBeCloseTo(40)
    expect(maxMoveDistance(250)).toBeCloseTo(70)
  })

  it('caps the elapsed time, so standing still never buys a long jump', () => {
    expect(maxMoveDistance(10_000)).toBeCloseTo(70)
    expect(maxMoveDistance(-500)).toBeCloseTo(20)
  })

  it('uses the server receive times of the two moves', () => {
    const from = { x: 100, y: 100 }
    expect(speedAllowed(from, { x: 116, y: 100 }, 1000, 1100)).toBe(true)
    expect(speedAllowed(from, { x: 140, y: 100 }, 1000, 1100)).toBe(true)
    expect(speedAllowed(from, { x: 141, y: 100 }, 1000, 1100)).toBe(false)
    // Two moves that arrive together still get the jitter allowance.
    expect(speedAllowed(from, { x: 112, y: 116 }, 1000, 1000)).toBe(true)
    expect(speedAllowed(from, { x: 100, y: 171 }, 0, 60_000)).toBe(false)
    expect(speedAllowed(from, { x: 100, y: 100 }, Number.NaN, 0)).toBe(false)
  })
})

describe('spendMoveBudget', () => {
  it('lets a client walk at MAX_SPEED for as long as it likes', () => {
    let budget: MoveBudget | null = fullMoveBudget(0)
    for (let t = 100; t <= 60_000 && budget !== null; t += 100) budget = spendMoveBudget(budget, 16, t)
    expect(budget?.px).toBeCloseTo(MOVE_BUDGET_PX - 16)
  })

  it('stops many small moves from adding up to more than SPEED_CAP x MAX_SPEED', () => {
    // Every one of these 20 px moves 50 ms apart passes speedAllowed (30 px), but together they go 400 px/s.
    let budget: MoveBudget | null = fullMoveBudget(0)
    let accepted = 0
    for (let t = 50; budget !== null; t += 50) {
      expect(speedAllowed({ x: 0, y: 0 }, { x: 20, y: 0 }, t - 50, t)).toBe(true)
      budget = spendMoveBudget(budget, 20, t)
      if (budget !== null) accepted++
    }
    // A full 200 px budget, then 10 px of refill and 20 px of travel per move.
    expect(accepted).toBe(19)
  })

  it('absorbs a burst after a stall up to one second of travel', () => {
    const budget = fullMoveBudget(0)
    expect(spendMoveBudget(budget, MOVE_BUDGET_PX, 0)?.px).toBe(0)
    expect(spendMoveBudget(budget, MOVE_BUDGET_PX + 1, 0)).toBeNull()
    expect(spendMoveBudget({ px: 0, atMs: 0 }, 100, 500)?.px).toBeCloseTo(0)
    expect(spendMoveBudget({ px: 0, atMs: 0 }, 1, 60_000)?.px).toBeCloseTo(MOVE_BUDGET_PX - 1)
    expect(spendMoveBudget(budget, Number.NaN, 0)).toBeNull()
  })
})

describe('sweptSegmentBlocked', () => {
  it('passes a move through free cells', () => {
    expect(sweptSegmentBlocked(open, cell(1, 1), cell(3, 3))).toBe(false)
    expect(sweptSegmentBlocked(open, cell(2, 2), cell(2, 2))).toBe(false)
  })

  it('blocks a move that ends in a blocked cell or stands in one', () => {
    const grid = walkGridFrom(['...', '.f.', '...'])
    expect(sweptSegmentBlocked(grid, cell(0, 1), cell(1, 1))).toBe(true)
    expect(sweptSegmentBlocked(grid, cell(1, 1), cell(1, 1))).toBe(true)
  })

  it('blocks a move through a wall even when both ends are free', () => {
    const grid = walkGridFrom(['.#.', '.#.', '.#.'])
    expect(sweptSegmentBlocked(grid, cell(0, 1), cell(2, 1), MOVE_CHECK_BODY)).toBe(true)
    expect(sweptSegmentBlocked(grid, cell(0, 0), cell(2, 2), MOVE_CHECK_BODY)).toBe(true)
  })

  it('blocks a diagonal between two diagonal wall cells', () => {
    const grid = walkGridFrom(['....', '.#..', '..#.', '....'])
    expect(sweptSegmentBlocked(grid, cell(1, 2), cell(2, 1), MOVE_CHECK_BODY)).toBe(true)
    // Off the exact corner as well.
    expect(sweptSegmentBlocked(grid, at(60, 70), at(70, 60), MOVE_CHECK_BODY)).toBe(true)
  })

  it('blocks a body that clips a wall corner while the feet point stays in free cells', () => {
    // Wall cell (2,2): x 64-96, y 64-96. The feet point runs along y = 61, 3 px above the wall.
    const grid = walkGridFrom(['.....', '.....', '..#..', '.....'])
    const from = at(40, 61)
    const to = at(120, 61)
    expect(sweptSegmentBlocked(grid, from, to, { w: 0, h: 0, offsetY: OFFSET })).toBe(false)
    expect(sweptSegmentBlocked(grid, from, to, PLAYER_BODY)).toBe(true)
    // The server body is MOVE_BODY_SLACK smaller per side (half height 1): 3 px clear passes, 0.5 px overlap does not.
    expect(sweptSegmentBlocked(grid, from, to, MOVE_CHECK_BODY)).toBe(false)
    expect(sweptSegmentBlocked(grid, at(40, 63.5), at(120, 63.5), MOVE_CHECK_BODY)).toBe(true)
    // A diagonal past the corner: the full body cuts it.
    expect(sweptSegmentBlocked(grid, at(50, 110), at(60, 40), PLAYER_BODY)).toBe(true)
  })

  it('does not count touching a wall edge as an overlap', () => {
    // Wall column 1 starts at x = 32; a 20 px body with its feet at x = 22 touches it.
    const grid = walkGridFrom(['.#', '.#', '.#'])
    expect(sweptSegmentBlocked(grid, at(22, 20), at(22, 80))).toBe(false)
    expect(sweptSegmentBlocked(grid, at(22.5, 20), at(22.5, 80))).toBe(true)
  })

  it('blocks a body outside the grid and non-finite positions', () => {
    expect(sweptSegmentBlocked(open, cell(0, 0), at(5, 16))).toBe(true)
    expect(sweptSegmentBlocked(open, cell(4, 4), at(5 * T + 20, 4 * T))).toBe(true)
    expect(sweptSegmentBlocked(open, cell(0, 0), { x: Number.NaN, y: 0 })).toBe(true)
    expect(sweptSegmentBlocked(open, cell(0, 0), { x: 1e300, y: 0 })).toBe(true)
  })
})

describe('checkMove', () => {
  const grid = walkGridFrom(['.#.', '...'])
  it('rejects too fast before it checks collisions', () => {
    expect(checkMove(grid, cell(0, 0), cell(0, 1), 100)).toEqual({ ok: true })
    expect(checkMove(grid, cell(0, 0), cell(2, 0), 100)).toEqual({ ok: false, reason: 'speed' })
    expect(checkMove(grid, cell(0, 0), cell(2, 0), 250)).toEqual({ ok: false, reason: 'collision' })
  })
})

describe('zoneEntryBlock', () => {
  const zone = (zoneType: ZoneDef['zoneType'], mediaMode: ZoneDef['mediaMode'], capacity: number): ZoneDef => ({
    id: zoneType,
    zoneType,
    mediaMode,
    capacity,
    lockable: false,
    priority: 0,
    rect: { x: 0, y: 0, w: T, h: T },
  })
  const member = { isGuest: false, guestZoneTypes: ['lobby', 'meeting'] as const, occupants: 0 }
  const guest = { ...member, isGuest: true }

  it('keeps guests to the guest zone types', () => {
    expect(zoneEntryBlock(zone('lobby', 'proximity', 0), guest)).toBeNull()
    expect(zoneEntryBlock(zone('meeting', 'room', 12), guest)).toBeNull()
    expect(zoneEntryBlock(zone('private', 'room', 4), guest)).toBe('guest')
    expect(zoneEntryBlock(zone('openplan', 'proximity', 0), guest)).toBe('guest')
    expect(zoneEntryBlock(zone('openplan', 'proximity', 0), { ...guest, guestZoneTypes: ['openplan'] })).toBeNull()
    expect(zoneEntryBlock(zone('private', 'room', 4), member)).toBeNull()
  })

  it('applies the capacity of room-mode zones only', () => {
    expect(zoneEntryBlock(zone('private', 'room', 4), { ...member, occupants: 3 })).toBeNull()
    expect(zoneEntryBlock(zone('private', 'room', 4), { ...member, occupants: 4 })).toBe('full')
    expect(zoneEntryBlock(zone('meeting', 'room', 0), { ...member, occupants: 50 })).toBeNull()
    expect(zoneEntryBlock(zone('openplan', 'proximity', 2), { ...member, occupants: 5 })).toBeNull()
  })
})

describe('nearestFreeStandSpot', () => {
  const room: ZoneDef = {
    id: 'room',
    zoneType: 'meeting',
    mediaMode: 'room',
    capacity: 0,
    lockable: false,
    priority: 0,
    rect: { x: 0, y: 0, w: 3 * T, h: 4 * T },
  }
  const seat = (x: number, y: number): SeatDef => ({ id: 's', zoneId: 'room', x, y, facing: 'down', hasComputer: false, computer: null })

  it('keeps the avatar on the seat when the body fits there', () => {
    expect(nearestFreeStandSpot({ zones: [room] }, open, seat(48, 48))).toEqual(at(48, 48))
  })

  it('moves the avatar to the nearest spot in the seat zone where the body fits', () => {
    // The seat is in a furniture cell (1,1).
    const grid = walkGridFrom(['....', '.f..', '....', '....', '....'])
    const spot = nearestFreeStandSpot({ zones: [room] }, grid, seat(48, 48))
    expect(sweptSegmentBlocked(grid, spot, spot)).toBe(false)
    expect(Math.hypot(spot.x - 48, spot.y + OFFSET - 48)).toBeLessThanOrEqual(48)
    expect(spot.x + 10).toBeLessThanOrEqual(3 * T)
  })

  it('does not stand up on the other side of a wall', () => {
    // The seat touches the wall row 1 from below; above the wall is free but in no line from the seat.
    const grid = walkGridFrom(['...', '###', '...', 'fff'])
    const spot = nearestFreeStandSpot({ zones: [room] }, grid, seat(48, 2 * T + 6))
    expect(spot.y + OFFSET).toBeGreaterThan(2 * T)
    expect(sweptSegmentBlocked(grid, spot, spot)).toBe(false)
  })
})

describe('movement on the real office map', () => {
  const map: OfficeMap = parseOfficeMap(
    JSON.parse(readFileSync(new URL('../../../apps/client/public/assets/map/map.json', import.meta.url), 'utf8')),
  )
  const walk = buildGrid(map, ['wall', 'furniture'])

  it('blocks the hallway to open-plan wall and passes the open-plan door', () => {
    expect(sweptSegmentBlocked(walk, cell(23, 13), cell(25, 13), MOVE_CHECK_BODY)).toBe(true)
    expect(sweptSegmentBlocked(walk, cell(23, 12), cell(25, 12), MOVE_CHECK_BODY)).toBe(false)
  })

  it('lets every seat keep its avatar in place on stand', () => {
    for (const s of map.seats) {
      expect(nearestFreeStandSpot(map, walk, s), s.id).toEqual({ x: s.x, y: s.y - OFFSET })
    }
  })
})
