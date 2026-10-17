import { describe, expect, it } from 'vitest'
import { buildGrid, cellKey, lineOfSight, reachableCells, type Grid } from '../src/grid.ts'
import type { ColliderDef, ColliderKind } from '../src/types.ts'

const T = 32

// '#' is a wall cell, 'f' a furniture cell, '.' free.
function gridFrom(rows: string[], kinds: ColliderKind[] = ['wall']): Grid {
  const colliders: ColliderDef[] = []
  rows.forEach((line, row) => {
    ;[...line].forEach((ch, col) => {
      const rect = { x: col * T, y: row * T, w: T, h: T }
      if (ch === '#') colliders.push({ name: '', kind: 'wall', rect })
      if (ch === 'f') colliders.push({ name: '', kind: 'furniture', rect })
    })
  })
  return buildGrid({ width: rows[0]?.length ?? 0, height: rows.length, tileWidth: T, tileHeight: T, colliders }, kinds)
}

const c = (cell: number) => cell * T + T / 2
const los = (grid: Grid, c0: number, r0: number, c1: number, r1: number) => lineOfSight(grid, c(c0), c(r0), c(c1), c(r1))

describe('buildGrid', () => {
  it('blocks a cell only when a collider covers its centre', () => {
    const colliders: ColliderDef[] = [
      { name: 'left half of cell 0', kind: 'wall', rect: { x: 0, y: 0, w: 16, h: 32 } },
      { name: 'centre of cell 2 to centre of cell 3', kind: 'wall', rect: { x: 80, y: 0, w: 32, h: 32 } },
    ]
    const grid = buildGrid({ width: 5, height: 1, tileWidth: T, tileHeight: T, colliders }, ['wall'])
    expect([0, 1, 2, 3, 4].map((col) => grid.blocked(col, 0))).toEqual([false, false, true, false, false])
  })

  it('uses only the requested collider kinds', () => {
    const rows = ['#f.']
    expect([0, 1, 2].map((col) => gridFrom(rows).blocked(col, 0))).toEqual([true, false, false])
    expect([0, 1, 2].map((col) => gridFrom(rows, ['wall', 'furniture']).blocked(col, 0))).toEqual([true, true, false])
  })

  it('treats cells outside the grid as blocked', () => {
    const grid = gridFrom(['..', '..'])
    expect(grid.blocked(0, 0)).toBe(false)
    expect([grid.blocked(-1, 0), grid.blocked(2, 0), grid.blocked(0, 2), grid.blocked(0.5, 0)]).toEqual([true, true, true, true])
  })
})

describe('lineOfSight', () => {
  it('horizontal', () => {
    const grid = gridFrom(['.....', '..#..'])
    expect(los(grid, 0, 0, 4, 0)).toBe(true)
    expect(los(grid, 0, 1, 4, 1)).toBe(false)
    expect(los(grid, 4, 1, 0, 1)).toBe(false)
  })

  it('vertical', () => {
    const grid = gridFrom(['..', '.#', '..'])
    expect(los(grid, 0, 0, 0, 2)).toBe(true)
    expect(los(grid, 1, 0, 1, 2)).toBe(false)
    expect(los(grid, 1, 2, 1, 0)).toBe(false)
  })

  it('diagonal', () => {
    expect(los(gridFrom(['....', '....', '....']), 0, 0, 3, 2)).toBe(true)
    const wall = gridFrom(['....', '.#..', '....'])
    expect(los(wall, 0, 0, 3, 2)).toBe(false)
    expect(los(wall, 3, 2, 0, 0)).toBe(false)
    expect(los(wall, 2, 0, 3, 2)).toBe(true)
  })

  it('blocks a line through the corner between two diagonal wall cells', () => {
    expect(los(gridFrom(['.#', '#.']), 0, 0, 1, 1)).toBe(false)
    expect(los(gridFrom(['.#', '#.']), 1, 1, 0, 0)).toBe(false)
    expect(los(gridFrom(['#.', '.#']), 1, 0, 0, 1)).toBe(false)
    expect(los(gridFrom(['#.', '.#']), 0, 1, 1, 0)).toBe(false)
    expect(los(gridFrom(['..', '..']), 0, 0, 1, 1)).toBe(true)
  })

  it('also blocks a line that only grazes the corner of one wall cell (supercover)', () => {
    expect(los(gridFrom(['.#', '..']), 0, 0, 1, 1)).toBe(false)
  })

  it('same cell', () => {
    const grid = gridFrom(['.#'])
    expect(lineOfSight(grid, 4, 4, 28, 28)).toBe(true)
    expect(lineOfSight(grid, 36, 4, 60, 28)).toBe(false)
  })

  it('is blocked when an endpoint is inside a wall or outside the grid', () => {
    const grid = gridFrom(['..#'])
    expect(los(grid, 0, 0, 2, 0)).toBe(false)
    expect(los(grid, 2, 0, 0, 0)).toBe(false)
    expect(lineOfSight(grid, 16, 16, -16, 16)).toBe(false)
    expect(lineOfSight(grid, 16, 16, Number.NaN, 16)).toBe(false)
  })

  it('handles points on cell boundaries', () => {
    const grid = gridFrom(['...', '.#.', '...'])
    expect(lineOfSight(grid, 0, 32, 96, 32)).toBe(false)
    expect(lineOfSight(grid, 0, 31.9, 95, 31.9)).toBe(true)
    expect(lineOfSight(grid, 32, 0, 32, 95)).toBe(false)
    expect(lineOfSight(grid, 31.9, 0, 31.9, 95)).toBe(true)
  })
})

describe('reachableCells', () => {
  const grid = gridFrom(['..#..', '..#..', '##.##'])

  it('walks 4-neighbours only, so a diagonal gap does not connect', () => {
    expect([...reachableCells(grid, c(0), c(0))].sort()).toEqual(['0,0', '0,1', '1,0', '1,1'])
    expect([...reachableCells(grid, c(2), c(2))]).toEqual(['2,2'])
    expect(reachableCells(grid, c(4), c(1)).has(cellKey(3, 0))).toBe(true)
  })

  it('is empty from a blocked or outside start', () => {
    expect(reachableCells(grid, c(2), c(0)).size).toBe(0)
    expect(reachableCells(grid, -5, 5).size).toBe(0)
  })

  it('covers the whole free area', () => {
    expect(reachableCells(gridFrom(['...', '.f.'], ['wall', 'furniture']), 0, 0).size).toBe(5)
  })
})
