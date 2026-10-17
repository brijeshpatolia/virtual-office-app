import { rectContains } from './geometry.ts'
import type { ColliderKind, OfficeMap } from './types.ts'

export interface Grid {
  cols: number
  rows: number
  cellWidth: number
  cellHeight: number
  // Cells outside the grid count as blocked.
  blocked(col: number, row: number): boolean
}

export interface Cell {
  col: number
  row: number
}

type GridSource = Pick<OfficeMap, 'width' | 'height' | 'tileWidth' | 'tileHeight' | 'colliders'>

export function buildGrid(map: GridSource, kinds: readonly ColliderKind[]): Grid {
  const cols = map.width
  const rows = map.height
  const cellWidth = map.tileWidth
  const cellHeight = map.tileHeight
  const cells = new Uint8Array(cols * rows)
  for (const { kind, rect } of map.colliders) {
    if (!kinds.includes(kind)) continue
    const c0 = Math.max(0, Math.floor(rect.x / cellWidth))
    const c1 = Math.min(cols - 1, Math.floor((rect.x + rect.w) / cellWidth))
    const r0 = Math.max(0, Math.floor(rect.y / cellHeight))
    const r1 = Math.min(rows - 1, Math.floor((rect.y + rect.h) / cellHeight))
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        if (rectContains(rect, (col + 0.5) * cellWidth, (row + 0.5) * cellHeight)) cells[row * cols + col] = 1
      }
    }
  }
  const blocked = (col: number, row: number): boolean =>
    !Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col >= cols || row >= rows
      ? true
      : cells[row * cols + col] === 1
  return { cols, rows, cellWidth, cellHeight, blocked }
}

export function cellAt(grid: Grid, x: number, y: number): Cell {
  return { col: Math.floor(x / grid.cellWidth), row: Math.floor(y / grid.cellHeight) }
}

export function cellKey(col: number, row: number): string {
  return `${col},${row}`
}

export function cellCenter(grid: Grid, col: number, row: number): { x: number; y: number } {
  return { x: (col + 0.5) * grid.cellWidth, y: (row + 0.5) * grid.cellHeight }
}

// Supercover traversal: every cell the segment touches, including both side cells where it passes exactly
// through a cell corner, so a line cannot slip between two diagonal wall cells.
export function lineOfSight(grid: Grid, x0: number, y0: number, x1: number, y1: number): boolean {
  if (![x0, y0, x1, y1].every(Number.isFinite)) return false
  let { col, row } = cellAt(grid, x0, y0)
  const end = cellAt(grid, x1, y1)
  if (grid.blocked(col, row)) return false
  const dx = x1 - x0
  const dy = y1 - y0
  const stepX = Math.sign(dx)
  const stepY = Math.sign(dy)
  while (col !== end.col || row !== end.row) {
    // Compare the parameter t of the next vertical and horizontal boundary crossing without dividing.
    const nextX = (stepX > 0 ? col + 1 : col) * grid.cellWidth
    const nextY = (stepY > 0 ? row + 1 : row) * grid.cellHeight
    const tx = stepX === 0 || col === end.col ? Infinity : Math.abs(nextX - x0) * Math.abs(dy)
    const ty = stepY === 0 || row === end.row ? Infinity : Math.abs(nextY - y0) * Math.abs(dx)
    if (tx < ty) {
      col += stepX
    } else if (ty < tx) {
      row += stepY
    } else {
      if (grid.blocked(col + stepX, row) || grid.blocked(col, row + stepY)) return false
      col += stepX
      row += stepY
    }
    if (grid.blocked(col, row)) return false
  }
  return true
}

// 4-neighbour breadth-first search over free cells. Empty when the start cell is blocked.
export function reachableCells(grid: Grid, startX: number, startY: number): Set<string> {
  const start = cellAt(grid, startX, startY)
  const seen = new Set<string>()
  if (grid.blocked(start.col, start.row)) return seen
  seen.add(cellKey(start.col, start.row))
  const queue: Cell[] = [start]
  for (let i = 0; i < queue.length; i++) {
    const cell = queue[i]
    if (cell === undefined) break
    for (const [dc, dr] of NEIGHBOURS) {
      const col = cell.col + dc
      const row = cell.row + dr
      const key = cellKey(col, row)
      if (grid.blocked(col, row) || seen.has(key)) continue
      seen.add(key)
      queue.push({ col, row })
    }
  }
  return seen
}

const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const
