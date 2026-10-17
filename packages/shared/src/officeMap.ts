import { REQUIRED_OBJECT_LAYERS, REQUIRED_TILE_LAYERS } from './constants.ts'
import { emptyMapObjects, LAYER_CLASSES, readObjectLayer } from './mapObjects.ts'
import { readProperties } from './properties.ts'
import { describePath, RawMapSchema, type RawLayer, type RawMap } from './tiled.ts'
import type { OfficeMap, TileLayerData } from './types.ts'

export class OfficeMapError extends Error {
  readonly issues: string[]

  constructor(issues: string[]) {
    super(`Invalid office map:\n${issues.map((issue) => `- ${issue}`).join('\n')}`)
    this.name = 'OfficeMapError'
    this.issues = issues
  }
}

// Reads a Tiled 1.11 JSON map. Throws OfficeMapError with every structural problem found, not only the first.
export function parseOfficeMap(json: unknown): OfficeMap {
  const parsed = RawMapSchema.safeParse(json)
  if (!parsed.success) {
    throw new OfficeMapError(parsed.error.issues.map((i) => `${describePath(json, i.path)}: ${i.message}`))
  }
  const raw = parsed.data
  const issues: string[] = []

  checkMapFormat(raw, issues)
  const layers = layersByName(raw.layers, issues)
  checkRequiredLayers(layers, issues)

  const objects = emptyMapObjects()
  for (const name of REQUIRED_OBJECT_LAYERS) {
    const layer = layers.get(name)
    if (layer?.type === 'objectgroup') readObjectLayer(layer, LAYER_CLASSES[name], objects, issues)
  }

  const mapProps = readProperties(raw.properties, 'map', issues)
  const templateId = mapProps.optionalString('templateId', '')
  const templateVersion = mapProps.optionalInt('templateVersion', 0)
  const tileLayers = readTileLayers(raw, issues)

  if (issues.length > 0) throw new OfficeMapError(issues)
  return {
    width: raw.width,
    height: raw.height,
    tileWidth: raw.tilewidth,
    tileHeight: raw.tileheight,
    widthPx: raw.width * raw.tilewidth,
    heightPx: raw.height * raw.tileheight,
    templateId,
    templateVersion,
    tilesetNames: raw.tilesets.map((t) => t.name ?? ''),
    tileLayers,
    ...objects,
  }
}

function checkMapFormat(raw: RawMap, issues: string[]): void {
  if (raw.orientation !== 'orthogonal') issues.push(`map: orientation must be orthogonal, got ${raw.orientation}`)
  if (raw.infinite === true) issues.push('map: infinite maps are not supported')
  raw.tilesets.forEach((t, i) => {
    const label = `tileset ${t.name ? `"${t.name}"` : `#${i}`} (firstgid ${t.firstgid})`
    if (t.source !== undefined) issues.push(`${label}: external tileset "${t.source}"; embed it in the map`)
    else if (!t.name) issues.push(`${label}: embedded tileset needs a name`)
  })
}

function layersByName(layers: readonly RawLayer[], issues: string[]): Map<string, RawLayer> {
  const byName = new Map<string, RawLayer>()
  for (const layer of layers) {
    if (layer.type === 'group') {
      issues.push(`layer "${layer.name}": group layers are not supported; move its layers to the top level`)
    }
    if (byName.has(layer.name)) issues.push(`layer "${layer.name}" appears more than once`)
    else byName.set(layer.name, layer)
  }
  return byName
}

function checkRequiredLayers(layers: ReadonlyMap<string, RawLayer>, issues: string[]): void {
  const want = [
    ...REQUIRED_TILE_LAYERS.map((name) => ({ name, type: 'tilelayer', label: 'tile layer', article: 'a' })),
    ...REQUIRED_OBJECT_LAYERS.map((name) => ({ name, type: 'objectgroup', label: 'object layer', article: 'an' })),
  ]
  for (const { name, type, label, article } of want) {
    const layer = layers.get(name)
    if (layer === undefined) issues.push(`missing ${label} "${name}"`)
    else if (layer.type !== type) issues.push(`layer "${name}" must be ${article} ${label} (${type}), got ${layer.type}`)
  }
}

function readTileLayers(raw: RawMap, issues: string[]): TileLayerData[] {
  const out: TileLayerData[] = []
  for (const layer of raw.layers) {
    if (layer.type !== 'tilelayer') continue
    const { name, width, height, data } = layer
    if (width !== raw.width || height !== raw.height) {
      issues.push(`layer "${name}": size ${width}x${height} must match the map size ${raw.width}x${raw.height}`)
    } else if (data.length !== width * height) {
      issues.push(`layer "${name}": has ${data.length} tiles, expected ${width * height}`)
    }
    out.push({ name, width, height, data })
  }
  return out
}
