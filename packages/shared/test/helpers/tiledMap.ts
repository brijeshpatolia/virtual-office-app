import { OfficeMapError, parseOfficeMap } from '../../src/officeMap.ts'
import type { OfficeMap } from '../../src/types.ts'
import { validateOfficeMap, type IssueCode } from '../../src/validate.ts'

// A small Tiled 1.11-style JSON map that passes every rule. 10x8 tiles of 32 px:
//
//      0123456789
//   0  ##########     # wall          R meeting room "room" (cols 1-4, rows 1-6)
//   1  #RRRR#OOO#     T table         O open plan "open" (cols 6-8, rows 1-6)
//   2  #RSCR#O*O#     S seat          D desk zone "desk" nested in open (cols 7-8, rows 4-6)
//   3  #RTTR.OOO#     C computer tile of s1 (tile property computer=true)
//   4  #RRRR#ODD#     * spawn "main"  . door "door1" (5,3), in no zone
//   5  #RRRR#ODS#
//   6  #RRRR#ODD#
//   7  ##########

export interface TestProperty {
  name: string
  type?: string
  value: unknown
}

export interface TestObject {
  id: number
  name: string
  type: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  visible: boolean
  point?: boolean
  ellipse?: boolean
  gid?: number
  template?: string
  properties?: TestProperty[]
}

export interface TestTileLayer {
  id: number
  name: string
  type: 'tilelayer'
  width: number
  height: number
  data: number[] | string
  encoding?: string
  opacity: number
  visible: boolean
  x: number
  y: number
}

export interface TestObjectLayer {
  id: number
  name: string
  type: 'objectgroup'
  draworder: string
  objects: TestObject[]
  opacity: number
  visible: boolean
  x: number
  y: number
  offsetx?: number
}

export interface TestOtherLayer {
  id: number
  name: string
  type: string
  layers?: unknown[]
}

export type TestLayer = TestTileLayer | TestObjectLayer | TestOtherLayer

export interface TestMap {
  type: 'map'
  version: string
  tiledversion: string
  orientation: string
  renderorder: string
  infinite: boolean
  width: number
  height: number
  tilewidth: number
  tileheight: number
  nextlayerid: number
  nextobjectid: number
  properties?: TestProperty[]
  tilesets: Record<string, unknown>[]
  layers: TestLayer[]
}

export const W = 10
export const H = 8
export const T = 32
export const COMPUTER_GID = 300
// A tile without the computer property, e.g. a desk.
export const PLAIN_GID = 5

export type PropValue = string | number | boolean

export function props(values: Record<string, PropValue>): TestProperty[] {
  return Object.entries(values).map(([name, value]) => ({ name, type: typeOf(value), value }))
}

function typeOf(value: PropValue): string {
  if (typeof value === 'string') return 'string'
  if (typeof value === 'boolean') return 'bool'
  return Number.isInteger(value) ? 'int' : 'float'
}

let nextId = 1

export function rectObject(
  type: string,
  name: string,
  [x, y, width, height]: [number, number, number, number],
  values: Record<string, PropValue>,
): TestObject {
  return { id: nextId++, name, type, x, y, width, height, rotation: 0, visible: true, properties: props(values) }
}

export function pointObject(type: string, name: string, x: number, y: number, values: Record<string, PropValue>): TestObject {
  return { id: nextId++, name, type, x, y, width: 0, height: 0, rotation: 0, visible: true, point: true, properties: props(values) }
}

// Tile (col,row) to the pixel rectangle covering cols c0..c1 and rows r0..r1.
export function cells(c0: number, r0: number, c1 = c0, r1 = r0): [number, number, number, number] {
  return [c0 * T, r0 * T, (c1 - c0 + 1) * T, (r1 - r0 + 1) * T]
}

export function center(col: number, row: number): { x: number; y: number } {
  return { x: col * T + T / 2, y: row * T + T / 2 }
}

function tileLayer(id: number, name: string, fill: number): TestTileLayer {
  return { id, name, type: 'tilelayer', width: W, height: H, data: new Array<number>(W * H).fill(fill), opacity: 1, visible: true, x: 0, y: 0 }
}

function objectLayer(id: number, name: string, objects: TestObject[]): TestObjectLayer {
  return { id, name, type: 'objectgroup', draworder: 'topdown', objects, opacity: 1, visible: true, x: 0, y: 0 }
}

const zone = (id: string, rect: [number, number, number, number], v: Omit<Record<string, PropValue>, 'zoneId'>) =>
  rectObject('zone', id, rect, { zoneId: id, ...v })
const wall = (name: string, rect: [number, number, number, number]) => rectObject('collider', name, rect, { kind: 'wall' })

export function baseTiledMap(): TestMap {
  nextId = 1
  const computers = tileLayer(5, 'Computers', 0)
  ;(computers.data as number[])[2 * W + 3] = COMPUTER_GID
  const s1 = center(2, 2)
  const s2 = center(8, 5)
  const spawn = center(7, 2)
  const layers: TestLayer[] = [
    tileLayer(1, 'Ground', 1),
    tileLayer(2, 'Obj_layer1', 0),
    tileLayer(3, 'Obj_layer2', 0),
    tileLayer(4, 'Obj_layer3', 0),
    computers,
    tileLayer(6, 'Above', 0),
    objectLayer(7, 'Zones', [
      zone('room', cells(1, 1, 4, 6), { zoneType: 'meeting', mediaMode: 'room', capacity: 4, lockable: true, priority: 2 }),
      zone('open', cells(6, 1, 8, 6), { zoneType: 'openplan', mediaMode: 'proximity', capacity: 0, lockable: false, priority: 0 }),
      zone('desk', cells(7, 4, 8, 6), { zoneType: 'desk', mediaMode: 'proximity', capacity: 0, lockable: false, priority: 1 }),
    ]),
    objectLayer(8, 'Seats', [
      pointObject('seat', 's1', s1.x, s1.y, {
        seatId: 's1',
        zoneId: 'room',
        facing: 'down',
        hasComputer: true,
        computerCol: 3,
        computerRow: 2,
      }),
      pointObject('seat', 's2', s2.x, s2.y, { seatId: 's2', zoneId: 'desk', facing: 'up', hasComputer: false }),
    ]),
    objectLayer(9, 'Interactables', [
      rectObject('whiteboard', 'wb1', cells(1, 1, 2, 1), { boardId: 'wb1', zoneId: 'room' }),
      rectObject('signage', 'sign1', cells(6, 1), { slotId: 'sign1' }),
      rectObject('door', 'door1', cells(5, 3), { doorId: 'door1' }),
      rectObject('stairs', 'stairs', cells(6, 6), { targetFloor: '' }),
    ]),
    objectLayer(10, 'Collision', [
      wall('top', cells(0, 0, 9, 0)),
      wall('bottom', cells(0, 7, 9, 7)),
      wall('left', cells(0, 1, 0, 6)),
      wall('right', cells(9, 1, 9, 6)),
      wall('middle-top', cells(5, 1, 5, 2)),
      wall('middle-bottom', cells(5, 4, 5, 6)),
      rectObject('collider', 'table', cells(2, 3, 3, 3), { kind: 'furniture' }),
    ]),
    objectLayer(11, 'Spawn', [pointObject('spawn', 'main', spawn.x, spawn.y, { spawnId: 'main' })]),
  ]
  return {
    type: 'map',
    version: '1.10',
    tiledversion: '1.11.0',
    orientation: 'orthogonal',
    renderorder: 'right-down',
    infinite: false,
    width: W,
    height: H,
    tilewidth: T,
    tileheight: T,
    nextlayerid: 12,
    nextobjectid: nextId,
    properties: props({ templateId: 'test-10x8', templateVersion: 1 }),
    tilesets: [
      {
        firstgid: 1,
        name: 'Test',
        image: 'test.png',
        imagewidth: 512,
        imageheight: 1024,
        columns: 16,
        tilecount: 512,
        tilewidth: 32,
        tileheight: 32,
        margin: 0,
        spacing: 0,
        tiles: [{ id: COMPUTER_GID - 1, properties: props({ computer: true }) }],
      },
    ],
    layers,
  }
}

export function layerOf(map: TestMap, name: string): TestLayer {
  const layer = map.layers.find((l) => l.name === name)
  if (!layer) throw new Error(`test map has no layer ${name}`)
  return layer
}

export function objectLayerOf(map: TestMap, name: string): TestObjectLayer {
  const layer = layerOf(map, name)
  if (layer.type !== 'objectgroup' || !('objects' in layer)) throw new Error(`${name} is not an object layer`)
  return layer
}

export function tileLayerOf(map: TestMap, name: string): TestTileLayer {
  const layer = layerOf(map, name)
  if (layer.type !== 'tilelayer' || !('data' in layer)) throw new Error(`${name} is not a tile layer`)
  return layer
}

export function objectOf(map: TestMap, layerName: string, name: string): TestObject {
  const object = objectLayerOf(map, layerName).objects.find((o) => o.name === name)
  if (!object) throw new Error(`no object ${name} in ${layerName}`)
  return object
}

// Works on an object or on the map itself.
export function setProp(holder: { properties?: TestProperty[] }, name: string, value: unknown, type?: string): void {
  const list = holder.properties ?? []
  const prop = list.find((p) => p.name === name)
  const next = { name, type: type ?? (typeof value === 'boolean' ? 'bool' : typeof value === 'number' ? 'int' : 'string'), value }
  if (prop) Object.assign(prop, next)
  else list.push(next)
  holder.properties = list
}

export function removeProp(holder: { properties?: TestProperty[] }, name: string): void {
  holder.properties = (holder.properties ?? []).filter((p) => p.name !== name)
}

export function removeLayer(map: TestMap, name: string): void {
  map.layers = map.layers.filter((l) => l.name !== name)
}

export function mapWith(mutate: (map: TestMap) => void = () => {}): TestMap {
  const map = baseTiledMap()
  mutate(map)
  return map
}

export function parsedWith(mutate?: (map: TestMap) => void): OfficeMap {
  return parseOfficeMap(mapWith(mutate))
}

export function issueCodes(mutate?: (map: TestMap) => void): IssueCode[] {
  return validateOfficeMap(parsedWith(mutate)).map((i) => i.code)
}

export function parseIssues(json: unknown): string[] {
  try {
    parseOfficeMap(json)
  } catch (error) {
    if (error instanceof OfficeMapError) return error.issues
    throw error
  }
  return []
}
