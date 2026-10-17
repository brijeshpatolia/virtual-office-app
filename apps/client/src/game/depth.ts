import type { REQUIRED_TILE_LAYERS } from '@vo/shared'

export type TileLayerName = (typeof REQUIRED_TILE_LAYERS)[number]

// Avatars (P1) draw between Computers and Above, so desk fronts and monitor backs cover a seated avatar.
export const DEPTH = {
  ground: 0,
  objects: 10,
  computers: 20,
  avatars: 30,
  above: 40,
  debug: 100,
} as const

export const TILE_LAYER_DEPTH: Record<TileLayerName, number> = {
  Ground: DEPTH.ground,
  Obj_layer1: DEPTH.objects,
  Obj_layer2: DEPTH.objects + 1,
  Obj_layer3: DEPTH.objects + 2,
  Computers: DEPTH.computers,
  Above: DEPTH.above,
}
