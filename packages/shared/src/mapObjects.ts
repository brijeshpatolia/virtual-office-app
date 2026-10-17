import { readProperties, type PropertyReader } from './properties.ts'
import type { RawObject, RawObjectGroup } from './tiled.ts'
import {
  COLLIDER_KINDS,
  FACINGS,
  MEDIA_MODES,
  ZONE_TYPES,
  type Cell,
  type OfficeMap,
  type Point,
  type Rect,
} from './types.ts'

export type MapObjects = Pick<
  OfficeMap,
  'zones' | 'seats' | 'whiteboards' | 'signage' | 'doors' | 'stairs' | 'colliders' | 'spawns'
>

export type ObjectClass = 'zone' | 'seat' | 'whiteboard' | 'signage' | 'door' | 'stairs' | 'collider' | 'spawn'

export const LAYER_CLASSES = {
  Zones: ['zone'],
  Seats: ['seat'],
  Interactables: ['whiteboard', 'signage', 'door', 'stairs'],
  Collision: ['collider'],
  Spawn: ['spawn'],
} as const satisfies Record<string, readonly ObjectClass[]>

interface Source {
  object: RawObject
  where: string
  props: PropertyReader
  issues: string[]
}

export function emptyMapObjects(): MapObjects {
  return { zones: [], seats: [], whiteboards: [], signage: [], doors: [], stairs: [], colliders: [], spawns: [] }
}

export function readObjectLayer(
  layer: RawObjectGroup,
  allowed: readonly ObjectClass[],
  out: MapObjects,
  issues: string[],
): void {
  if ((layer.offsetx ?? 0) !== 0 || (layer.offsety ?? 0) !== 0) {
    issues.push(`layer "${layer.name}": layer offsets are not supported; set them to 0`)
  }
  for (const object of layer.objects) {
    const where = describeObject(layer.name, object)
    const cls = allowed.find((c) => c === object.type)
    if (cls === undefined) {
      issues.push(`${where}: class "${object.type ?? ''}" is not allowed here (allowed: ${allowed.join(', ')})`)
      continue
    }
    if (!isPlainObject(object, where, issues)) continue
    addObject(cls, { object, where, props: readProperties(object.properties, where, issues), issues }, out)
  }
}

function describeObject(layerName: string, o: RawObject): string {
  const name = o.name ? ` "${o.name}"` : ''
  return `layer "${layerName}" > object id ${o.id}${name}`
}

function isPlainObject(o: RawObject, where: string, issues: string[]): boolean {
  const before = issues.length
  if (o.gid !== undefined) issues.push(`${where}: tile objects (gid) cannot carry map data`)
  if (o.template !== undefined) issues.push(`${where}: object templates are not supported; detach the template`)
  if ((o.rotation ?? 0) !== 0) issues.push(`${where}: rotated objects are not allowed`)
  return issues.length === before
}

function shapeOf(o: RawObject): string {
  if (o.point === true) return 'point'
  if (o.ellipse === true) return 'ellipse'
  if (o.capsule === true) return 'capsule'
  if (o.polygon !== undefined) return 'polygon'
  if (o.polyline !== undefined) return 'polyline'
  if (o.text !== undefined) return 'text'
  return 'rectangle'
}

function rectOf({ object: o, where, issues }: Source): Rect {
  const shape = shapeOf(o)
  const rect = { x: o.x, y: o.y, w: o.width ?? 0, h: o.height ?? 0 }
  if (shape !== 'rectangle') issues.push(`${where}: must be a rectangle, got a ${shape}`)
  else if (!(rect.w > 0 && rect.h > 0)) issues.push(`${where}: rectangle needs a positive width and height`)
  return rect
}

function pointOf({ object: o, where, issues }: Source): Point {
  const shape = shapeOf(o)
  if (shape !== 'point') issues.push(`${where}: must be a point, got a ${shape}`)
  return { x: o.x, y: o.y }
}

function computerCell({ props, where, issues }: Source): Cell | null {
  const col = props.optionalInt('computerCol')
  const row = props.optionalInt('computerRow')
  if (col !== undefined && row !== undefined) return { col, row }
  if (col !== undefined || row !== undefined) issues.push(`${where}: set both computerCol and computerRow, or neither`)
  return null
}

function addObject(cls: ObjectClass, src: Source, out: MapObjects): void {
  const { props } = src
  switch (cls) {
    case 'zone': {
      const capacity = props.int('capacity')
      if (capacity < 0) src.issues.push(`${src.where}: capacity must be 0 (no limit) or more`)
      out.zones.push({
        id: props.id('zoneId'),
        zoneType: props.oneOf('zoneType', ZONE_TYPES),
        mediaMode: props.oneOf('mediaMode', MEDIA_MODES),
        capacity,
        lockable: props.bool('lockable'),
        priority: props.int('priority'),
        rect: rectOf(src),
      })
      return
    }
    case 'seat': {
      const { x, y } = pointOf(src)
      out.seats.push({
        id: props.id('seatId'),
        zoneId: props.id('zoneId'),
        x,
        y,
        facing: props.oneOf('facing', FACINGS),
        hasComputer: props.bool('hasComputer'),
        computer: computerCell(src),
      })
      return
    }
    case 'whiteboard':
      out.whiteboards.push({ id: props.id('boardId'), zoneId: props.id('zoneId'), rect: rectOf(src) })
      return
    case 'signage':
      out.signage.push({ id: props.id('slotId'), rect: rectOf(src) })
      return
    case 'door':
      out.doors.push({ id: props.id('doorId'), rect: rectOf(src) })
      return
    case 'stairs':
      out.stairs.push({ rect: rectOf(src), targetFloor: props.string('targetFloor') })
      return
    case 'collider':
      out.colliders.push({ name: src.object.name ?? '', kind: props.oneOf('kind', COLLIDER_KINDS), rect: rectOf(src) })
      return
    case 'spawn': {
      const { x, y } = pointOf(src)
      out.spawns.push({ id: props.id('spawnId'), x, y })
      return
    }
  }
}
