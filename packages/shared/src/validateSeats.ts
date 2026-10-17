import { MAIN_SPAWN_ID, SIT_RADIUS } from './constants.ts'
import { distance } from './geometry.ts'
import { cellAt, cellCenter, cellKey, reachableCells, type Grid } from './grid.ts'
import type { OfficeMap, SeatDef, SpawnDef } from './types.ts'
import type { ValidationIssue } from './validate.ts'
import { zoneAt } from './zones.ts'

export interface MapGrids {
  walls: Grid
  // Walls and furniture: where an avatar cannot stand.
  solid: Grid
}

export function checkSeats(map: OfficeMap, { walls, solid }: MapGrids): ValidationIssue[] {
  const spawn = usableSpawn(map, solid)
  // Without a usable spawn, checkSpawn reports it once instead of every seat failing here.
  const reachable = spawn ? reachableCells(solid, spawn.x, spawn.y) : null
  const issues: ValidationIssue[] = []
  for (const seat of map.seats) {
    const ref = seat.id
    const zone = zoneAt(map, seat.x, seat.y)
    if (zone?.id !== seat.zoneId) {
      const actual = zone ? `zone "${zone.id}"` : 'no zone'
      issues.push({ code: 'seat-zone', message: `seat "${ref}" has zoneId "${seat.zoneId}" but lies in ${actual}`, ref })
    }
    const cell = cellAt(walls, seat.x, seat.y)
    if (walls.blocked(cell.col, cell.row)) {
      issues.push({ code: 'seat-on-wall', message: `seat "${ref}" is on a wall cell (${cell.col},${cell.row})`, ref })
    }
    if (reachable && !reachableWithin(solid, reachable, seat, SIT_RADIUS)) {
      const message = `seat "${ref}": no cell reachable from spawn "${MAIN_SPAWN_ID}" within ${SIT_RADIUS} px`
      issues.push({ code: 'seat-unreachable', message, ref })
    }
  }
  return issues
}

export function checkSpawn(map: OfficeMap, { solid }: MapGrids): ValidationIssue[] {
  const count = map.spawns.filter((s) => s.id === MAIN_SPAWN_ID).length
  if (count !== 1) {
    const message = `expected exactly one spawn "${MAIN_SPAWN_ID}", found ${count}`
    return [{ code: 'spawn-main', message, ref: MAIN_SPAWN_ID }]
  }
  if (usableSpawn(map, solid)) return []
  return [{ code: 'spawn-blocked', message: `spawn "${MAIN_SPAWN_ID}" is not on a walkable cell`, ref: MAIN_SPAWN_ID }]
}

function usableSpawn(map: OfficeMap, solid: Grid): SpawnDef | null {
  const mains = map.spawns.filter((s) => s.id === MAIN_SPAWN_ID)
  const spawn = mains.length === 1 ? mains[0] : undefined
  if (spawn === undefined) return null
  const { col, row } = cellAt(solid, spawn.x, spawn.y)
  return solid.blocked(col, row) ? null : spawn
}

function reachableWithin(grid: Grid, reachable: ReadonlySet<string>, seat: SeatDef, radius: number): boolean {
  const from = cellAt(grid, seat.x - radius, seat.y - radius)
  const to = cellAt(grid, seat.x + radius, seat.y + radius)
  for (let row = from.row; row <= to.row; row++) {
    for (let col = from.col; col <= to.col; col++) {
      const center = cellCenter(grid, col, row)
      if (reachable.has(cellKey(col, row)) && distance(seat.x, seat.y, center.x, center.y) <= radius) return true
    }
  }
  return false
}
