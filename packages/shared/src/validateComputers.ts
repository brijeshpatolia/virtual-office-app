import { COMPUTER_TILE_LAYERS } from './constants.ts'
import { cellKey } from './grid.ts'
import type { Cell, OfficeMap, SeatDef } from './types.ts'
import type { ValidationIssue } from './validate.ts'

// Tiled keeps the flip flags in the top bits of a gid.
const GID_MASK = 0x0fffffff

// A computer seat names the cell of its own sprite, so a neighbouring desk, bench or another seat's
// monitor never counts. The cell must hold a tile that its tileset marks with computer=true.
export function checkComputers(map: OfficeMap): ValidationIssue[] {
  const gids = new Set(map.computerGids)
  const names: readonly string[] = COMPUTER_TILE_LAYERS
  const layers = map.tileLayers.filter((l) => names.includes(l.name))
  const isComputer = ({ col, row }: Cell): boolean =>
    col >= 0 && row >= 0 && col < map.width && row < map.height &&
    layers.some((l) => gids.has((l.data[row * l.width + col] ?? 0) & GID_MASK))

  const owners = new Map<string, string>()
  const issues: ValidationIssue[] = []
  for (const seat of map.seats) {
    const problem = computerProblem(map, seat, isComputer, owners)
    if (problem) issues.push({ code: 'seat-computer', message: `seat "${seat.id}" ${problem}`, ref: seat.id })
  }
  return issues
}

function computerProblem(
  map: OfficeMap,
  seat: SeatDef,
  isComputer: (cell: Cell) => boolean,
  owners: Map<string, string>,
): string | null {
  const { computer } = seat
  if (!seat.hasComputer) return computer ? 'sets computerCol/computerRow but hasComputer is false' : null
  if (!computer) return 'has a computer but no computerCol/computerRow for its sprite'
  const at = `(${computer.col},${computer.row})`
  const col = Math.floor(seat.x / map.tileWidth)
  const row = Math.floor(seat.y / map.tileHeight)
  if (Math.max(Math.abs(computer.col - col), Math.abs(computer.row - row)) > 1) {
    return `has its computer at ${at}, more than 1 tile from the seat (${col},${row})`
  }
  if (!isComputer(computer)) {
    return `has its computer at ${at}, but no tile there in ${COMPUTER_TILE_LAYERS.join(' or ')} is marked computer=true`
  }
  const key = cellKey(computer.col, computer.row)
  const owner = owners.get(key)
  if (owner !== undefined) return `has its computer at ${at}, which is already the computer of seat "${owner}"`
  owners.set(key, seat.id)
  return null
}
