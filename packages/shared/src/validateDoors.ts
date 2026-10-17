import { cellsIn } from './grid.ts'
import type { Cell, OfficeMap } from './types.ts'
import type { ValidationIssue } from './validate.ts'
import type { MapGrids } from './validateSeats.ts'
import { zoneAt } from './zones.ts'

const list = (cells: readonly Cell[]): string => cells.map((c) => `(${c.col},${c.row})`).join(', ')

// Door cells belong to no zone, so a person in a doorway is in neither room. They must also stay walkable.
export function checkDoors(map: OfficeMap, { solid }: MapGrids): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  for (const door of map.doors) {
    const ref = door.id
    const cells = cellsIn(map, door.rect)
    const zoned = cells.flatMap((c) => {
      const zone = zoneAt(map, (c.col + 0.5) * map.tileWidth, (c.row + 0.5) * map.tileHeight)
      return zone ? [{ cell: c, zone: zone.id }] : []
    })
    if (zoned.length > 0) {
      const zones = [...new Set(zoned.map((z) => `"${z.zone}"`))].join(', ')
      const message = `door "${ref}" overlaps zone ${zones} at ${list(zoned.map((z) => z.cell))}; keep doors outside every zone`
      issues.push({ code: 'door-zone', message, ref })
    }
    const blocked = cells.filter((c) => solid.blocked(c.col, c.row))
    if (blocked.length > 0) {
      issues.push({ code: 'door-blocked', message: `door "${ref}" is blocked by a collider at ${list(blocked)}`, ref })
    }
  }
  return issues
}
