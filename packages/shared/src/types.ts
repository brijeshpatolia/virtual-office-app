export const ZONE_TYPES = ['private', 'lobby', 'meeting', 'hallway', 'openplan', 'desk'] as const
export const MEDIA_MODES = ['proximity', 'room'] as const
export const FACINGS = ['up', 'down', 'left', 'right'] as const
export const COLLIDER_KINDS = ['wall', 'furniture'] as const

export type ZoneType = (typeof ZONE_TYPES)[number]
export type MediaMode = (typeof MEDIA_MODES)[number]
export type Facing = (typeof FACINGS)[number]
export type ColliderKind = (typeof COLLIDER_KINDS)[number]

export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

// A tile position: column and row, counting from 0.
export interface Cell {
  col: number
  row: number
}

export interface ZoneDef {
  id: string
  zoneType: ZoneType
  mediaMode: MediaMode
  capacity: number
  lockable: boolean
  priority: number
  rect: Rect
}

export interface SeatDef {
  id: string
  zoneId: string
  x: number
  y: number
  facing: Facing
  hasComputer: boolean
  // The tile of this seat's own computer sprite (seat properties computerCol and computerRow).
  computer: Cell | null
}

export interface WhiteboardDef {
  id: string
  zoneId: string
  rect: Rect
}

export interface SignageDef {
  id: string
  rect: Rect
}

export interface DoorDef {
  id: string
  rect: Rect
}

export interface StairsDef {
  rect: Rect
  targetFloor: string
}

export interface ColliderDef {
  name: string
  kind: ColliderKind
  rect: Rect
}

export interface SpawnDef {
  id: string
  x: number
  y: number
}

export interface TilesetDef {
  name: string
  // Path of the tileset image, relative to the map file.
  image: string
  firstGid: number
}

export interface TileLayerData {
  name: string
  width: number
  height: number
  data: number[]
}

export interface OfficeMap {
  width: number
  height: number
  tileWidth: number
  tileHeight: number
  widthPx: number
  heightPx: number
  templateId: string
  templateVersion: number
  tilesets: TilesetDef[]
  // Gids of the tiles whose tileset marks them with the bool property computer=true.
  computerGids: number[]
  tileLayers: TileLayerData[]
  zones: ZoneDef[]
  seats: SeatDef[]
  whiteboards: WhiteboardDef[]
  signage: SignageDef[]
  doors: DoorDef[]
  stairs: StairsDef[]
  colliders: ColliderDef[]
  spawns: SpawnDef[]
}
