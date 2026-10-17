import { z } from 'zod'

// Only the fields the office map needs. z.object drops unknown keys, so extra Tiled fields are allowed.
const int = z.number().int()

export const RawPropertySchema = z.object({
  name: z.string(),
  type: z.string().optional(),
  value: z.unknown(),
})

// Shape and tile fields are read only to reject them: data objects must be plain rectangles or points.
export const RawObjectSchema = z.object({
  id: int,
  name: z.string().optional(),
  type: z.string().optional(),
  x: z.number(),
  y: z.number(),
  width: z.number().optional(),
  height: z.number().optional(),
  rotation: z.number().optional(),
  point: z.boolean().optional(),
  ellipse: z.boolean().optional(),
  capsule: z.boolean().optional(),
  polygon: z.array(z.unknown()).optional(),
  polyline: z.array(z.unknown()).optional(),
  text: z.unknown().optional(),
  gid: int.optional(),
  template: z.string().optional(),
  properties: z.array(RawPropertySchema).optional(),
})

const RawTileLayerSchema = z.object({
  type: z.literal('tilelayer'),
  id: int,
  name: z.string(),
  width: int.positive(),
  height: int.positive(),
  data: z.array(int.nonnegative(), {
    error: 'tile data must be a JSON array (set the tile layer format to CSV in Tiled)',
  }),
})

const RawObjectGroupSchema = z.object({
  type: z.literal('objectgroup'),
  id: int,
  name: z.string(),
  offsetx: z.number().optional(),
  offsety: z.number().optional(),
  objects: z.array(RawObjectSchema),
})

const RawImageLayerSchema = z.object({ type: z.literal('imagelayer'), id: int, name: z.string() })
const RawGroupLayerSchema = z.object({ type: z.literal('group'), id: int, name: z.string() })

const RawLayerSchema = z.discriminatedUnion(
  'type',
  [RawTileLayerSchema, RawObjectGroupSchema, RawImageLayerSchema, RawGroupLayerSchema],
  { error: 'layer type must be tilelayer, objectgroup, imagelayer or group' },
)

const RawTileSchema = z.object({
  id: int.nonnegative(),
  properties: z.array(RawPropertySchema).optional(),
})

export const RawTilesetSchema = z.object({
  firstgid: int.positive(),
  name: z.string().optional(),
  source: z.string().optional(),
  image: z.string().optional(),
  tiles: z.array(RawTileSchema).optional(),
})

export const RawMapSchema = z.object({
  orientation: z.string(),
  infinite: z.boolean().optional(),
  width: int.positive(),
  height: int.positive(),
  tilewidth: int.positive(),
  tileheight: int.positive(),
  properties: z.array(RawPropertySchema).optional(),
  tilesets: z.array(RawTilesetSchema),
  layers: z.array(RawLayerSchema),
})

export type RawProperty = z.infer<typeof RawPropertySchema>
export type RawObject = z.infer<typeof RawObjectSchema>
export type RawLayer = z.infer<typeof RawLayerSchema>
export type RawTileLayer = z.infer<typeof RawTileLayerSchema>
export type RawObjectGroup = z.infer<typeof RawObjectGroupSchema>
export type RawTileset = z.infer<typeof RawTilesetSchema>
export type RawMap = z.infer<typeof RawMapSchema>

// Turns ['layers', 3, 'objects', 1, 'x'] into 'layer "Seats" > object id 9 > x'.
export function describePath(json: unknown, path: readonly PropertyKey[]): string {
  const parts: string[] = []
  let node: unknown = json
  for (let i = 0; i < path.length; i++) {
    const key = path[i]
    const next = path[i + 1]
    const value = childOf(node, key)
    if ((key === 'layers' || key === 'objects') && typeof next === 'number') {
      node = childOf(value, next)
      parts.push(labelOf(key, next, node))
      i++
    } else {
      parts.push(String(key))
      node = value
    }
  }
  return parts.length > 0 ? parts.join(' > ') : 'map'
}

function childOf(node: unknown, key: PropertyKey | undefined): unknown {
  if (key === undefined || typeof node !== 'object' || node === null) return undefined
  return (node as Record<PropertyKey, unknown>)[key]
}

function labelOf(key: 'layers' | 'objects', index: number, item: unknown): string {
  if (key === 'layers') {
    const name = childOf(item, 'name')
    return typeof name === 'string' ? `layer "${name}"` : `layers[${index}]`
  }
  const id = childOf(item, 'id')
  return typeof id === 'number' ? `object id ${id}` : `objects[${index}]`
}
