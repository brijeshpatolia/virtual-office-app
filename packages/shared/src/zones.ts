import { ZONE_DWELL_MS, ZONE_EXIT_MARGIN } from './constants.ts'
import { distanceToRect, rectArea, rectContains } from './geometry.ts'
import type { OfficeMap, ZoneDef } from './types.ts'

type ZoneSource = Pick<OfficeMap, 'zones'>

function outranks(a: ZoneDef, b: ZoneDef): boolean {
  return a.priority > b.priority || (a.priority === b.priority && rectArea(a.rect) < rectArea(b.rect))
}

// Highest priority wins; on a tie the smaller zone wins, then the first one in the map.
export function zoneAt(map: ZoneSource, x: number, y: number): ZoneDef | null {
  let best: ZoneDef | null = null
  for (const zone of map.zones) {
    if (rectContains(zone.rect, x, y) && (best === null || outranks(zone, best))) best = zone
  }
  return best
}

export interface ZoneTrackerOptions {
  // How far (px) the point must be outside the current zone before it counts as left.
  exitMargin?: number
  // How long (ms) a new zone must stay the target before the change is committed. Use 0 on the server.
  dwellMs?: number
}

export interface ZoneUpdate {
  zoneId: string | null
  changed: boolean
}

// Hysteresis for zone changes, so jitter at a zone edge does not flap media modes.
// The same class runs on the client (each frame, with dwell) and on the server (each move, dwell 0).
export class ZoneTracker {
  private readonly map: ZoneSource
  private readonly exitMargin: number
  private readonly dwellMs: number
  private current: ZoneDef | null = null
  private started = false
  // undefined: no change pending; null: "no zone" is pending.
  private pending: ZoneDef | null | undefined = undefined
  private pendingSince = 0

  constructor(map: ZoneSource, opts: ZoneTrackerOptions = {}) {
    this.map = map
    this.exitMargin = opts.exitMargin ?? ZONE_EXIT_MARGIN
    this.dwellMs = opts.dwellMs ?? ZONE_DWELL_MS
  }

  get zoneId(): string | null {
    return this.current?.id ?? null
  }

  update(x: number, y: number, nowMs: number): ZoneUpdate {
    const target = this.target(x, y)
    // The first position (or the first after reset) has nothing to flap against.
    if (!this.started) {
      this.started = true
      return this.commit(target)
    }
    if (target === this.current) {
      this.pending = undefined
      return { zoneId: this.zoneId, changed: false }
    }
    if (target !== this.pending) {
      this.pending = target
      this.pendingSince = nowMs
    }
    if (nowMs - this.pendingSince >= this.dwellMs) return this.commit(target)
    return { zoneId: this.zoneId, changed: false }
  }

  // Forget the current zone, e.g. after a teleport. The next update commits at once.
  reset(): void {
    this.current = null
    this.started = false
    this.pending = undefined
  }

  private target(x: number, y: number): ZoneDef | null {
    const hit = zoneAt(this.map, x, y)
    const current = this.current
    if (current === null || distanceToRect(current.rect, x, y) > this.exitMargin) return hit
    // Inside the exit margin we stay, unless a higher-priority zone (a room or desk nested inside) contains the point.
    return hit !== null && hit.priority > current.priority ? hit : current
  }

  private commit(target: ZoneDef | null): ZoneUpdate {
    const changed = (target?.id ?? null) !== this.zoneId
    this.current = target
    this.pending = undefined
    return { zoneId: this.zoneId, changed }
  }
}
