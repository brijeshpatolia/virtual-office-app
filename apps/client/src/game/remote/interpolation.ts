import { PATCH_RATE_MS, type Facing } from '@vo/shared'

export interface Snapshot {
  // Local receive time in ms (performance.now()).
  t: number
  x: number
  y: number
  dir: Facing
  moving: boolean
  seated: boolean
}

export interface Pose {
  x: number
  y: number
  dir: Facing
  moving: boolean
  seated: boolean
}

// Remote avatars are drawn this far in the past, so there is usually a newer position to move towards. Two patch
// intervals: a walker's moves (every 100-117 ms) leave some 100 ms patches empty, and a one-patch delay then runs
// past the newest snapshot (the avatar stalls, then jumps).
export const INTERPOLATION_DELAY_MS = 2 * PATCH_RATE_MS
// A jump this long (sit, snap back, reconnect) is shown at once instead of being walked.
export const TELEPORT_PX = 96
const KEEP = 32

// Positions of one remote player, sampled with a fixed delay and linear interpolation. No extrapolation:
// when the newest snapshot is older than the render time, the avatar waits there.
export class InterpolationBuffer {
  private readonly delayMs: number
  private readonly teleportPx: number
  private snapshots: Snapshot[] = []

  constructor(options: { delayMs?: number; teleportPx?: number } = {}) {
    this.delayMs = options.delayMs ?? INTERPOLATION_DELAY_MS
    this.teleportPx = options.teleportPx ?? TELEPORT_PX
  }

  get size(): number {
    return this.snapshots.length
  }

  push(snapshot: Snapshot): void {
    const last = this.snapshots.at(-1)
    if (last && Math.hypot(snapshot.x - last.x, snapshot.y - last.y) > this.teleportPx) this.snapshots = []
    else if (last && snapshot.t < last.t) return
    this.snapshots.push({ ...snapshot })
    if (this.snapshots.length > KEEP) this.snapshots.splice(0, this.snapshots.length - KEEP)
  }

  sample(now: number): Pose | null {
    const first = this.snapshots[0]
    if (!first) return null
    const renderTime = now - this.delayMs
    // Drop what is no longer needed: keep the last snapshot at or before the render time.
    let from = 0
    while (from + 1 < this.snapshots.length && (this.snapshots[from + 1] as Snapshot).t <= renderTime) from++
    if (from > 0) this.snapshots.splice(0, from)
    const a = this.snapshots[0] as Snapshot
    const b = this.snapshots[1]
    if (!b || renderTime <= a.t) return pose(a)
    const k = Math.min(1, (renderTime - a.t) / (b.t - a.t || 1))
    // Seated only once the seat is reached; standing up shows at once.
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, dir: b.dir, moving: a.moving || b.moving, seated: a.seated && b.seated }
  }
}

const pose = ({ x, y, dir, moving, seated }: Snapshot): Pose => ({ x, y, dir, moving, seated })
