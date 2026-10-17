import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildGrid, lineOfSight } from '../src/grid.ts'
import { parseOfficeMap } from '../src/officeMap.ts'
import type { OfficeMap } from '../src/types.ts'
import { summarizeOfficeMap, validateOfficeMap } from '../src/validate.ts'
import { zoneAt } from '../src/zones.ts'

// The office map that ships with the client (see the map annotation plan).
const mapUrl = new URL('../../../apps/client/public/assets/map/map.json', import.meta.url)

let cached: OfficeMap | undefined
// Loaded on first use, so a parse error shows up in each test with its issue list.
const officeMap = (): OfficeMap => (cached ??= parseOfficeMap(JSON.parse(readFileSync(mapUrl, 'utf8'))))

const center = (col: number, row: number) => ({ x: col * 32 + 16, y: row * 32 + 16 })

describe('apps/client map.json', () => {
  it('passes every validator rule', () => {
    expect(validateOfficeMap(officeMap())).toEqual([])
  })

  it('has the planned zones, seats, boards and spawn', () => {
    const map = officeMap()
    expect(summarizeOfficeMap(map)).toMatchObject({ zones: 7, seats: 17, computerSeats: 11, whiteboards: 3, spawns: 1 })
    expect(map.zones.map((z) => z.id).sort()).toEqual(
      ['hallway', 'lobby', 'meeting-room', 'open-plan', 'pod-a', 'pod-b', 'private-office'],
    )
    expect(map.seats.filter((s) => s.hasComputer).map((s) => s.id).sort()).toEqual(
      ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'm4', 'm5', 'p1'],
    )
    expect(map.templateId).toBe('startup-hq-40x30')
    expect(map.templateVersion).toBe(1)
  })

  it.each([
    [21, 8],
    [21, 9],
    [24, 12],
    [11, 13],
    [11, 14],
  ])('keeps the door cell (%i,%i) outside every zone', (col, row) => {
    const { x, y } = center(col, row)
    expect(zoneAt(officeMap(), x, y)).toBeNull()
  })

  it.each([
    ['hallway (23,15) to open-plan (25,15)', [23, 15], [25, 15], false],
    ['lobby (22,12) to open-plan (26,12) through the door', [22, 12], [26, 12], true],
    ['lobby (20,11) to hallway (21,14)', [20, 11], [21, 14], true],
    ['lobby (15,12) to meeting room (15,15)', [15, 12], [15, 15], false],
  ] as const)('line of sight %s', (_label, [c0, r0], [c1, r1], clear) => {
    const walls = buildGrid(officeMap(), ['wall'])
    const a = center(c0, r0)
    const b = center(c1, r1)
    expect(lineOfSight(walls, a.x, a.y, b.x, b.y)).toBe(clear)
  })
})
