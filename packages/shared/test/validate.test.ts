import { describe, expect, it } from 'vitest'
import type { MediaMode, OfficeMap } from '../src/types.ts'
import { summarizeOfficeMap, validateOfficeMap, type IssueCode } from '../src/validate.ts'
import {
  center,
  cells,
  COMPUTER_GID,
  issueCodes,
  objectLayerOf,
  objectOf,
  parsedWith,
  pointObject,
  rectObject,
  removeProp,
  setProp,
  tileLayerOf,
  W,
  type TestMap,
} from './helpers/tiledMap.ts'

function moveTo(map: TestMap, layer: string, name: string, col: number, row: number): void {
  Object.assign(objectOf(map, layer, name), center(col, row))
}

function codesOf(map: OfficeMap): IssueCode[] {
  return validateOfficeMap(map).map((i) => i.code)
}

describe('validateOfficeMap', () => {
  it('accepts the synthetic base map', () => {
    expect(validateOfficeMap(parsedWith())).toEqual([])
  })

  // [rule, a variant that must still pass, a variant that must fail with exactly this code]
  const rules: [IssueCode, (m: TestMap) => void, (m: TestMap) => void][] = [
    ['template-id', (m) => setProp(m, 'templateId', 'other'), (m) => removeProp(m, 'templateId')],
    ['template-version', (m) => setProp(m, 'templateVersion', 7), (m) => setProp(m, 'templateVersion', 0)],
    [
      'duplicate-id',
      (m) => setProp(objectOf(m, 'Interactables', 'wb1'), 'boardId', 's1'),
      (m) => setProp(objectOf(m, 'Seats', 's2'), 'seatId', 's1'),
    ],
    [
      'zone-overlap',
      // A zone that only touches others is fine.
      (m) => objectLayerOf(m, 'Zones').objects.push(rectObject('zone', 'nook', cells(5, 3), zoneProps('nook', 0))),
      (m) => Object.assign(objectOf(m, 'Zones', 'desk'), { x: 224, width: 96 }),
    ],
    [
      'zone-priority',
      (m) => setProp(objectOf(m, 'Zones', 'desk'), 'priority', 5),
      (m) => setProp(objectOf(m, 'Zones', 'desk'), 'priority', 0),
    ],
    [
      'seat-zone',
      (m) => moveTo(m, 'Seats', 's2', 7, 6),
      (m) => setProp(objectOf(m, 'Seats', 's2'), 'zoneId', 'open'),
    ],
    [
      'seat-on-wall',
      // A seat on furniture is fine: sitting snaps the avatar onto it.
      (m) => moveTo(m, 'Seats', 's1', 2, 3),
      (m) => objectLayerOf(m, 'Collision').objects.push(rectObject('collider', 'pillar', cells(8, 5), { kind: 'wall' })),
    ],
    [
      'seat-unreachable',
      (m) => objectLayerOf(m, 'Collision').objects.push(rectObject('collider', 'desk-block', cells(8, 5), { kind: 'furniture' })),
      // Close the door (5,3), so the room cannot be reached from the spawn.
      (m) => Object.assign(objectOf(m, 'Collision', 'middle-top'), { height: 96 }),
    ],
    [
      'seat-computer',
      // A tile in the Above layer diagonal to the seat counts.
      (m) => {
        tileLayerOf(m, 'Computers').data = new Array<number>(80).fill(0)
        ;(tileLayerOf(m, 'Above').data as number[])[3 * W + 3] = COMPUTER_GID
      },
      // Two tiles away is too far.
      (m) => {
        const data = new Array<number>(80).fill(0)
        data[2 * W + 4] = COMPUTER_GID
        tileLayerOf(m, 'Computers').data = data
      },
    ],
    [
      'whiteboard-zone',
      (m) => setProp(objectOf(m, 'Interactables', 'wb1'), 'zoneId', 'open'),
      (m) => setProp(objectOf(m, 'Interactables', 'wb1'), 'zoneId', 'nowhere'),
    ],
    [
      'spawn-main',
      (m) => objectLayerOf(m, 'Spawn').objects.push(pointObject('spawn', 'side', 240, 112, { spawnId: 'side' })),
      (m) => setProp(objectOf(m, 'Spawn', 'main'), 'spawnId', 'lobby'),
    ],
    ['spawn-blocked', (m) => moveTo(m, 'Spawn', 'main', 4, 3), (m) => moveTo(m, 'Spawn', 'main', 2, 3)],
  ]

  describe.each(rules)('%s', (code, passing, failing) => {
    it('passes', () => expect(issueCodes(passing)).toEqual([]))
    it('fails', () => expect(issueCodes(failing)).toEqual([code]))
  })

  it('reports every duplicated id kind', () => {
    const issues = validateOfficeMap(
      parsedWith((m) => {
        setProp(objectOf(m, 'Zones', 'desk'), 'zoneId', 'room')
        setProp(objectOf(m, 'Seats', 's2'), 'zoneId', 'room')
        objectLayerOf(m, 'Interactables').objects.push(
          rectObject('whiteboard', 'wb2', cells(1, 6), { boardId: 'wb1', zoneId: 'room' }),
          rectObject('signage', 'sign2', cells(6, 2), { slotId: 'sign1' }),
        )
        objectLayerOf(m, 'Spawn').objects.push(pointObject('spawn', 'main2', 240, 112, { spawnId: 'main' }))
      }),
    ).filter((i) => i.code === 'duplicate-id')
    expect(issues.map((i) => i.message)).toEqual([
      'duplicate zoneId "room"',
      'duplicate boardId "wb1"',
      'duplicate slotId "sign1"',
      'duplicate spawnId "main"',
    ])
  })

  it('reports a seat outside every zone', () => {
    const issues = validateOfficeMap(parsedWith((m) => moveTo(m, 'Seats', 's2', 5, 3)))
    expect(issues).toEqual([{ code: 'seat-zone', message: 'seat "s2" has zoneId "desk" but lies in no zone', ref: 's2' }])
  })

  it('reports identical zone rectangles as an overlap', () => {
    const codes = issueCodes((m) => Object.assign(objectOf(m, 'Zones', 'desk'), { x: 192, y: 32, width: 96, height: 192 }))
    expect(codes).toContain('zone-overlap')
  })

  it('reports two main spawns', () => {
    const codes = issueCodes((m) => objectLayerOf(m, 'Spawn').objects.push(pointObject('spawn', 'x', 240, 112, { spawnId: 'main' })))
    expect(codes).toEqual(['duplicate-id', 'spawn-main'])
  })

  it('reports a spawn outside the map', () => {
    expect(issueCodes((m) => Object.assign(objectOf(m, 'Spawn', 'main'), { x: -10 }))).toEqual(['spawn-blocked'])
  })

  it('checks mediaMode values even when the map was not parsed from Tiled', () => {
    const map = parsedWith()
    const room = map.zones[0]
    if (room) room.mediaMode = 'group' as MediaMode
    expect(codesOf(map)).toEqual(['media-mode'])
    expect(codesOf(parsedWith())).not.toContain('media-mode')
  })

  it('checks the required tile layers', () => {
    const missing = parsedWith()
    missing.tileLayers = missing.tileLayers.filter((l) => l.name !== 'Above')
    expect(codesOf(missing)).toEqual(['missing-tile-layer'])

    const short = parsedWith()
    const above = short.tileLayers.find((l) => l.name === 'Above')
    if (above) above.data = above.data.slice(1)
    expect(codesOf(short)).toEqual(['tile-layer-size'])
  })

  it('needs a template version even when the property is missing', () => {
    expect(issueCodes((m) => removeProp(m, 'templateVersion'))).toEqual(['template-version'])
  })

  // Other cell sizes also move every seat and spawn to other grid cells, so more rules fail with it.
  it('needs 32 px tiles', () => {
    expect(issueCodes()).not.toContain('tile-size')
    expect(issueCodes((m) => Object.assign(m, { tilewidth: 16, tileheight: 16 }))).toContain('tile-size')
  })
})

describe('summarizeOfficeMap', () => {
  it('counts the map objects', () => {
    expect(summarizeOfficeMap(parsedWith())).toEqual({
      zones: 3,
      seats: 2,
      computerSeats: 1,
      whiteboards: 1,
      signage: 1,
      stairs: 1,
      colliders: { wall: 6, furniture: 1 },
      spawns: 1,
    })
  })
})

function zoneProps(id: string, priority: number) {
  return { zoneId: id, zoneType: 'hallway', mediaMode: 'proximity', capacity: 0, lockable: false, priority }
}
