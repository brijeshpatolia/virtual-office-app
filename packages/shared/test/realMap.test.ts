import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildGrid, cellsIn, lineOfSight } from '../src/grid.ts'
import { parseOfficeMap } from '../src/officeMap.ts'
import type { OfficeMap } from '../src/types.ts'
import { summarizeOfficeMap, validateOfficeMap } from '../src/validate.ts'
import { zoneAt } from '../src/zones.ts'

// The office map that ships with the client (see the map annotation plan).
const mapUrl = new URL('../../../apps/client/public/assets/map/map.json', import.meta.url)
const mapText = readFileSync(mapUrl, 'utf8')

interface RawTileLayer {
  name: string
  type: string
  width: number
  data: number[]
}

interface RawObject {
  name: string
  type: string
  [key: string]: unknown
}

interface RawMap {
  layers: (RawTileLayer & { objects?: RawObject[] })[]
}

let cached: OfficeMap | undefined
// Loaded on first use, so a parse error shows up in each test with its issue list.
const officeMap = (): OfficeMap => (cached ??= parseOfficeMap(JSON.parse(mapText)))

// A fresh copy of the raw map, changed by `mutate`, then parsed.
function officeMapWith(mutate: (raw: RawMap) => void): OfficeMap {
  const raw = JSON.parse(mapText) as RawMap
  mutate(raw)
  return parseOfficeMap(raw)
}

function layer(raw: RawMap, name: string): RawTileLayer & { objects?: RawObject[] } {
  const found = raw.layers.find((l) => l.name === name)
  if (!found) throw new Error(`map.json has no layer ${name}`)
  return found
}

function object(raw: RawMap, layerName: string, name: string): RawObject {
  const found = layer(raw, layerName).objects?.find((o) => o.name === name)
  if (!found) throw new Error(`map.json has no object ${name} in ${layerName}`)
  return found
}

const center = (col: number, row: number) => ({ x: col * 32 + 16, y: row * 32 + 16 })

const DOOR_CELLS = [
  [21, 8],
  [21, 9],
  [24, 12],
  [11, 13],
  [11, 14],
] as const

// Each computer seat and the tile of its own sprite.
const COMPUTER_CELLS = [
  ['m4', 9, 18],
  ['m5', 15, 18],
  ['p1', 29, 5],
  ['d1', 31, 16],
  ['d2', 34, 16],
  ['d3', 37, 16],
  ['d4', 31, 22],
  ['d5', 34, 22],
  ['d6', 37, 22],
  ['d7', 31, 24],
  ['d8', 37, 24],
] as const

describe('apps/client map.json', () => {
  it('passes every validator rule', () => {
    expect(validateOfficeMap(officeMap())).toEqual([])
  })

  it('has the planned zones, seats, boards, doors and spawn', () => {
    const map = officeMap()
    expect(summarizeOfficeMap(map)).toMatchObject({ zones: 7, seats: 17, computerSeats: 11, whiteboards: 3, doors: 3, spawns: 1 })
    expect(map.zones.map((z) => z.id).sort()).toEqual(
      ['hallway', 'lobby', 'meeting-room', 'open-plan', 'pod-a', 'pod-b', 'private-office'],
    )
    expect(map.seats.filter((s) => s.hasComputer).map((s) => s.id).sort()).toEqual(
      ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'm4', 'm5', 'p1'],
    )
    expect(map.templateId).toBe('startup-hq-40x30')
    expect(map.templateVersion).toBe(1)
  })

  it('marks the planned door cells as doors', () => {
    const cells = officeMap().doors.flatMap((d) => cellsIn(officeMap(), d.rect).map((c) => [c.col, c.row]))
    expect(cells.sort()).toEqual(DOOR_CELLS.map((c) => [...c]).sort())
  })

  it.each(DOOR_CELLS)('keeps the door cell (%i,%i) outside every zone', (col, row) => {
    const { x, y } = center(col, row)
    expect(zoneAt(officeMap(), x, y)).toBeNull()
  })

  it.each([
    ['the lobby grows over the open-plan door', 'lobby', { width: 608 }, 'door-open-plan'],
    ['the meeting room grows over its door', 'meeting-room', { y: 416, height: 256 }, 'door-meeting-room'],
  ] as const)('reports door-zone when %s', (_label, zone, change, door) => {
    const map = officeMapWith((raw) => Object.assign(object(raw, 'Zones', zone), change))
    expect(validateOfficeMap(map).map((i) => [i.code, i.ref])).toEqual([['door-zone', door]])
  })

  it.each(COMPUTER_CELLS)('links seat %s to its computer sprite at (%i,%i)', (seatId, col, row) => {
    expect(officeMap().seats.find((s) => s.id === seatId)?.computer).toEqual({ col, row })
  })

  // Neighbouring furniture or another seat's monitor must not stand in for a missing sprite.
  it.each(COMPUTER_CELLS)('reports seat-computer for %s when its sprite tile (%i,%i) is removed', (seatId, col, row) => {
    const map = officeMapWith((raw) => {
      for (const name of ['Computers', 'Above']) {
        const tiles = layer(raw, name)
        tiles.data[row * tiles.width + col] = 0
      }
    })
    expect(validateOfficeMap(map).map((i) => [i.code, i.ref])).toEqual([['seat-computer', seatId]])
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
