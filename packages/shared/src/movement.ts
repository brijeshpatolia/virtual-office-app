import { distance } from './geometry.ts'
import { cellAt, lineOfSight, type Grid } from './grid.ts'
import { MAX_SPEED, MOVE_JITTER_MS, MOVE_MAX_DT_MS, PLAYER_BODY, SPEED_CAP } from './protocol/constants.ts'
import type { MoveRejectReason } from './protocol/messages.ts'
import type { OfficeMap, Point, SeatDef, ZoneDef, ZoneType } from './types.ts'
import { zoneAt } from './zones.ts'

// Server move checks, shared so the client can predict the same verdict.
// Positions are sprite centres; a body box is centred on the feet point (position.y + offsetY).

export interface BodyBox {
  w: number
  h: number
  offsetY: number
}

// The server sweeps a smaller body than the client's Arcade body. The client slides around wall corners, and the
// straight segment between two move samples cuts such a corner by up to a quarter of the travel per axis
// (about 3 px at 100 ms and MAX_SPEED, 5 px when a slow frame stretches the interval to 150 ms).
export const MOVE_BODY_SLACK = 5
export const MOVE_CHECK_BODY: BodyBox = {
  w: PLAYER_BODY.w - 2 * MOVE_BODY_SLACK,
  h: PLAYER_BODY.h - 2 * MOVE_BODY_SLACK,
  offsetY: PLAYER_BODY.offsetY,
}

const CAP_PX_PER_MS = (MAX_SPEED * SPEED_CAP) / 1000

// The farthest an accepted move may go after elapsedMs (server receive time since the last accepted move).
export function maxMoveDistance(elapsedMs: number): number {
  const elapsed = Math.min(Math.max(elapsedMs, 0), MOVE_MAX_DT_MS)
  return CAP_PX_PER_MS * (elapsed + MOVE_JITTER_MS)
}

export function speedAllowed(prev: Point, next: Point, prevServerMs: number, nowServerMs: number): boolean {
  return distance(prev.x, prev.y, next.x, next.y) <= maxMoveDistance(nowServerMs - prevServerMs)
}

// The jitter allowance in speedAllowed counts again on every move, so a client that sends often could reach about
// 3 x MAX_SPEED with that check alone. A distance budget keeps the sustained speed at SPEED_CAP x MAX_SPEED: it
// refills at that speed and holds two seconds of it, so the moves that arrive in one burst after a network stall of
// up to 2.5 s still pass. After a longer stall the client snaps back to the last accepted position.
export const MOVE_BUDGET_SECONDS = 2
export const MOVE_BUDGET_PX = MAX_SPEED * SPEED_CAP * MOVE_BUDGET_SECONDS

export interface MoveBudget {
  px: number
  atMs: number
}

export function fullMoveBudget(nowMs: number): MoveBudget {
  return { px: MOVE_BUDGET_PX, atMs: nowMs }
}

// The budget left after a move of distancePx at nowMs, or null when the budget does not cover it.
export function spendMoveBudget(budget: MoveBudget, distancePx: number, nowMs: number): MoveBudget | null {
  const refilled = Math.min(MOVE_BUDGET_PX, budget.px + Math.max(0, nowMs - budget.atMs) * CAP_PX_PER_MS)
  const px = refilled - distancePx
  return px >= 0 ? { px, atMs: Math.max(nowMs, budget.atMs) } : null
}

// True when the body, swept along the straight segment from `from` to `to`, overlaps a blocked cell or leaves the
// grid. Touching a cell edge is not an overlap. A swept box is the hull of its two end boxes, so a separating-axis
// test on x, y and the segment normal is exact.
export function sweptSegmentBlocked(grid: Grid, from: Point, to: Point, body: BodyBox = PLAYER_BODY): boolean {
  const x0 = from.x
  const y0 = from.y + body.offsetY
  const x1 = to.x
  const y1 = to.y + body.offsetY
  if (![x0, y0, x1, y1].every(Number.isFinite)) return true
  if (body.w <= 0 || body.h <= 0) return !lineOfSight(grid, x0, y0, x1, y1)
  const hw = body.w / 2
  const hh = body.h / 2
  const minX = Math.min(x0, x1) - hw
  const maxX = Math.max(x0, x1) + hw
  const minY = Math.min(y0, y1) - hh
  const maxY = Math.max(y0, y1) + hh
  const { cellWidth: cw, cellHeight: ch } = grid
  if (minX < 0 || minY < 0 || maxX > grid.cols * cw || maxY > grid.rows * ch) return true
  const nx = -(y1 - y0)
  const ny = x1 - x0
  const still = nx === 0 && ny === 0
  const reach = Math.abs(nx) * (hw + cw / 2) + Math.abs(ny) * (hh + ch / 2)
  for (let row = Math.floor(minY / ch); row < Math.ceil(maxY / ch); row++) {
    for (let col = Math.floor(minX / cw); col < Math.ceil(maxX / cw); col++) {
      if (!grid.blocked(col, row)) continue
      if (still) return true
      const across = ((col + 0.5) * cw - x0) * nx + ((row + 0.5) * ch - y0) * ny
      if (Math.abs(across) < reach) return true
    }
  }
  return false
}

export type MoveVerdict = { ok: true } | { ok: false; reason: Extract<MoveRejectReason, 'speed' | 'collision'> }

// The speed and collision part of the server move check. elapsedMs is the time since the last accepted move.
export function checkMove(walkGrid: Grid, from: Point, to: Point, elapsedMs: number): MoveVerdict {
  if (!speedAllowed(from, to, 0, elapsedMs)) return { ok: false, reason: 'speed' }
  if (sweptSegmentBlocked(walkGrid, from, to, MOVE_CHECK_BODY)) return { ok: false, reason: 'collision' }
  return { ok: true }
}

export interface ZoneEntryContext {
  isGuest: boolean
  guestZoneTypes: readonly ZoneType[]
  // People already in the zone, not counting the one who enters.
  occupants: number
}

// Why a person may not enter `zone`, or null. Capacity counts only for room-mode zones.
export function zoneEntryBlock(zone: ZoneDef, ctx: ZoneEntryContext): Extract<MoveRejectReason, 'guest' | 'full'> | null {
  if (ctx.isGuest && !ctx.guestZoneTypes.includes(zone.zoneType)) return 'guest'
  if (zone.mediaMode === 'room' && zone.capacity > 0 && ctx.occupants >= zone.capacity) return 'full'
  return null
}

const STAND_STEP = 4
const STAND_RADIUS = 48
// Offsets within STAND_RADIUS, nearest first.
const STAND_OFFSETS: readonly Point[] = (() => {
  const out: Point[] = []
  for (let dy = -STAND_RADIUS; dy <= STAND_RADIUS; dy += STAND_STEP) {
    for (let dx = -STAND_RADIUS; dx <= STAND_RADIUS; dx += STAND_STEP) {
      if (Math.hypot(dx, dy) <= STAND_RADIUS) out.push({ x: dx, y: dy })
    }
  }
  return out.sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y))
})()

// Where a person stands up: the seat itself when the full body fits there, else the nearest spot in the seat's
// zone where it fits and that the feet point can reach in a straight line. Falls back to the seat.
export function nearestFreeStandSpot(map: Pick<OfficeMap, 'zones'>, grid: Grid, seat: SeatDef): Point {
  const offsetY = PLAYER_BODY.offsetY
  const origin = { x: seat.x, y: seat.y - offsetY }
  const seatCell = cellAt(grid, seat.x, seat.y)
  const needsLine = !grid.blocked(seatCell.col, seatCell.row)
  for (const offset of STAND_OFFSETS) {
    const spot = { x: origin.x + offset.x, y: origin.y + offset.y }
    if (sweptSegmentBlocked(grid, spot, spot)) continue
    if ((zoneAt(map, spot.x, spot.y + offsetY)?.id ?? '') !== seat.zoneId) continue
    if (needsLine && !lineOfSight(grid, seat.x, seat.y, spot.x, spot.y + offsetY)) continue
    return spot
  }
  return origin
}
