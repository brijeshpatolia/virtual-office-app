import { readProperties } from './properties.ts'
import type { RawTileset } from './tiled.ts'
import type { TilesetDef } from './types.ts'

export interface Tilesets {
  tilesets: TilesetDef[]
  computerGids: number[]
}

// Only embedded single-image tilesets: the client loads each image from its `image` path.
export function readTilesets(raw: readonly RawTileset[], issues: string[]): Tilesets {
  const tilesets: TilesetDef[] = []
  const computerGids: number[] = []
  for (const [i, t] of raw.entries()) {
    const label = `tileset ${t.name ? `"${t.name}"` : `#${i}`} (firstgid ${t.firstgid})`
    if (t.source !== undefined) {
      issues.push(`${label}: external tileset "${t.source}"; embed it in the map`)
      continue
    }
    if (!t.name || !t.image) {
      issues.push(`${label}: ${!t.name ? 'embedded tileset needs a name' : 'needs one image; image collection tilesets are not supported'}`)
      continue
    }
    if (tilesets.some((other) => other.name === t.name)) issues.push(`${label}: another tileset has the same name`)
    tilesets.push({ name: t.name, image: t.image, firstGid: t.firstgid })
    for (const tile of t.tiles ?? []) {
      const props = readProperties(tile.properties, `${label} > tile ${tile.id}`, issues)
      if (props.optionalBool('computer') === true) computerGids.push(t.firstgid + tile.id)
    }
  }
  return { tilesets, computerGids }
}
