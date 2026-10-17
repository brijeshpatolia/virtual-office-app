import { REQUIRED_TILE_LAYERS, TILE } from './constants.ts'
import { rectInside, rectsEqual, rectsOverlap } from './geometry.ts'
import { buildGrid } from './grid.ts'
import { checkComputers, checkSeats, checkSpawn } from './validateSeats.ts'
import { MEDIA_MODES, type ColliderKind, type OfficeMap } from './types.ts'

export type IssueCode =
  | 'tile-size'
  | 'missing-tile-layer'
  | 'tile-layer-size'
  | 'duplicate-id'
  | 'media-mode'
  | 'zone-overlap'
  | 'zone-priority'
  | 'seat-zone'
  | 'seat-on-wall'
  | 'seat-unreachable'
  | 'seat-computer'
  | 'whiteboard-zone'
  | 'spawn-main'
  | 'spawn-blocked'
  | 'template-id'
  | 'template-version'

export interface ValidationIssue {
  code: IssueCode
  message: string
  // The id of the zone, seat, board, slot or spawn the issue is about.
  ref?: string
}

export interface OfficeMapSummary {
  zones: number
  seats: number
  computerSeats: number
  whiteboards: number
  signage: number
  stairs: number
  colliders: Record<ColliderKind, number>
  spawns: number
}

export function validateOfficeMap(map: OfficeMap): ValidationIssue[] {
  const grids = { walls: buildGrid(map, ['wall']), solid: buildGrid(map, ['wall', 'furniture']) }
  return [
    ...checkTileSize(map),
    ...checkTileLayers(map),
    ...checkTemplate(map),
    ...checkUniqueIds(map),
    ...checkMediaModes(map),
    ...checkZoneNesting(map),
    ...checkSeats(map, grids),
    ...checkComputers(map),
    ...checkWhiteboards(map),
    ...checkSpawn(map, grids),
  ]
}

export function summarizeOfficeMap(map: OfficeMap): OfficeMapSummary {
  const colliders: Record<ColliderKind, number> = { wall: 0, furniture: 0 }
  for (const c of map.colliders) colliders[c.kind]++
  return {
    zones: map.zones.length,
    seats: map.seats.length,
    computerSeats: map.seats.filter((s) => s.hasComputer).length,
    whiteboards: map.whiteboards.length,
    signage: map.signage.length,
    stairs: map.stairs.length,
    colliders,
    spawns: map.spawns.length,
  }
}

function checkTileSize(map: OfficeMap): ValidationIssue[] {
  if (map.tileWidth === TILE && map.tileHeight === TILE) return []
  return [{ code: 'tile-size', message: `tiles must be ${TILE}x${TILE} px, got ${map.tileWidth}x${map.tileHeight}` }]
}

function checkTileLayers(map: OfficeMap): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  for (const name of REQUIRED_TILE_LAYERS) {
    const layer = map.tileLayers.find((l) => l.name === name)
    if (layer === undefined) {
      issues.push({ code: 'missing-tile-layer', message: `missing tile layer "${name}"`, ref: name })
    } else if (layer.width !== map.width || layer.height !== map.height || layer.data.length !== map.width * map.height) {
      issues.push({ code: 'tile-layer-size', message: `tile layer "${name}" does not match the map size`, ref: name })
    }
  }
  return issues
}

function checkTemplate(map: OfficeMap): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (map.templateId.trim() === '') {
    issues.push({ code: 'template-id', message: 'map property "templateId" (string) is missing or empty' })
  }
  if (!Number.isInteger(map.templateVersion) || map.templateVersion < 1) {
    issues.push({ code: 'template-version', message: 'map property "templateVersion" (int) must be 1 or more' })
  }
  return issues
}

function checkUniqueIds(map: OfficeMap): ValidationIssue[] {
  const groups: [string, { id: string }[]][] = [
    ['zoneId', map.zones],
    ['seatId', map.seats],
    ['boardId', map.whiteboards],
    ['slotId', map.signage],
    ['spawnId', map.spawns],
  ]
  const issues: ValidationIssue[] = []
  for (const [property, items] of groups) {
    const seen = new Set<string>()
    for (const { id } of items) {
      if (seen.has(id)) issues.push({ code: 'duplicate-id', message: `duplicate ${property} "${id}"`, ref: id })
      seen.add(id)
    }
  }
  return issues
}

function checkMediaModes(map: OfficeMap): ValidationIssue[] {
  return map.zones
    .filter((z) => !MEDIA_MODES.includes(z.mediaMode))
    .map((z) => ({
      code: 'media-mode',
      message: `zone "${z.id}": mediaMode must be one of ${MEDIA_MODES.join(', ')}, got "${String(z.mediaMode)}"`,
      ref: z.id,
    }))
}

// Zones may touch or nest. A nested zone must be strictly smaller and have a higher priority than its parent.
function checkZoneNesting(map: OfficeMap): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  map.zones.forEach((a, i) => {
    for (const b of map.zones.slice(i + 1)) {
      if (!rectsOverlap(a.rect, b.rect)) continue
      const pair = `zones "${a.id}" and "${b.id}"`
      if (rectsEqual(a.rect, b.rect) || !(rectInside(a.rect, b.rect) || rectInside(b.rect, a.rect))) {
        issues.push({ code: 'zone-overlap', message: `${pair} overlap; zones must be disjoint or nested`, ref: b.id })
        continue
      }
      const [inner, outer] = rectInside(a.rect, b.rect) ? [a, b] : [b, a]
      if (inner.priority <= outer.priority) {
        issues.push({
          code: 'zone-priority',
          message: `zone "${inner.id}" is nested in "${outer.id}" and needs a higher priority (${inner.priority} <= ${outer.priority})`,
          ref: inner.id,
        })
      }
    }
  })
  return issues
}

function checkWhiteboards(map: OfficeMap): ValidationIssue[] {
  const zoneIds = new Set(map.zones.map((z) => z.id))
  return map.whiteboards
    .filter((b) => !zoneIds.has(b.zoneId))
    .map((b) => ({
      code: 'whiteboard-zone',
      message: `whiteboard "${b.id}": zoneId "${b.zoneId}" is not a zone`,
      ref: b.id,
    }))
}
