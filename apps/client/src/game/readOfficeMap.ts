import type Phaser from 'phaser'
import { parseOfficeMap, REQUIRED_TILE_LAYERS, validateOfficeMap, type OfficeMap } from '@vo/shared'

// Parses the raw Tiled JSON that the loader put in the tilemap cache. A structural problem throws
// OfficeMapError; rule violations are logged so the office still renders while someone fixes the map.
export function readOfficeMap(scene: Phaser.Scene, key: string): OfficeMap {
  const entry: unknown = scene.cache.tilemap.get(key)
  if (typeof entry !== 'object' || entry === null || !('data' in entry)) {
    throw new Error(`Tilemap "${key}" is not in the cache`)
  }
  const map = parseOfficeMap(entry.data)
  for (const issue of validateOfficeMap(map)) {
    console.error(`Office map issue [${issue.code}]: ${issue.message}`)
  }
  const drawn: readonly string[] = REQUIRED_TILE_LAYERS
  for (const { name } of map.tileLayers) {
    if (!drawn.includes(name)) console.warn(`Tile layer "${name}" is not drawn; the client draws ${drawn.join(', ')}`)
  }
  return map
}
