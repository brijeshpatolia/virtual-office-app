import type { REQUIRED_TILE_LAYERS } from '@vo/shared'

export type TileLayerName = (typeof REQUIRED_TILE_LAYERS)[number]

// Avatars draw between Computers and Above, so desk fronts and monitor backs cover a seated avatar.
// Name tags draw over Above, so a name stays readable behind the meeting table.
export const DEPTH = {
  ground: 0,
  objects: 10,
  computers: 20,
  avatars: 30,
  above: 40,
  labels: 50,
  debug: 100,
} as const

// Within the avatar band, lower feet draw in front.
export const avatarDepth = (feetY: number): number => DEPTH.avatars + Math.min(Math.max(feetY, 0), 99_999) / 100_000

export const TILE_LAYER_DEPTH: Record<TileLayerName, number> = {
  Ground: DEPTH.ground,
  Obj_layer1: DEPTH.objects,
  Obj_layer2: DEPTH.objects + 1,
  Obj_layer3: DEPTH.objects + 2,
  Computers: DEPTH.computers,
  Above: DEPTH.above,
}
