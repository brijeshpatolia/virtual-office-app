import { MOVE_INTERVAL_MS, type Facing, type MoveMessage } from '@vo/shared'

export interface MoveSample {
  x: number
  y: number
  dir: Facing
  moving: boolean
}

// A start, stop or turn goes out at once, but never closer than this to the previous move (it waits a frame or two
// instead), so key mashing stays far below MAX_MESSAGES_PER_SECOND.
export const MIN_SEND_GAP_MS = 50

// Decides when the local player sends 'move': every MOVE_INTERVAL_MS while the position changes, and at once on
// a start, stop or turn, so the server's straight segments follow the corners of the path.
export class MoveSender {
  private seq = 0
  private last: MoveSample
  private lastSentAt = Number.NEGATIVE_INFINITY
  private ignoreRejectsUpTo = 0

  constructor(start: MoveSample) {
    this.last = { ...start }
  }

  get lastSeq(): number {
    return this.seq
  }

  // force: skip MIN_SEND_GAP_MS (a stop right before the game loop pauses).
  update(now: number, sample: MoveSample, force = false): MoveMessage | null {
    const sinceLast = now - this.lastSentAt
    if (sinceLast < MIN_SEND_GAP_MS && !force) return null
    const turned = sample.moving !== this.last.moving || (sample.moving && sample.dir !== this.last.dir)
    const moved = sample.x !== this.last.x || sample.y !== this.last.y
    if (!turned && !(moved && (force || sinceLast >= MOVE_INTERVAL_MS))) return null
    this.seq += 1
    this.last = { ...sample }
    this.lastSentAt = now
    return { x: sample.x, y: sample.y, dir: sample.dir, moving: sample.moving, seq: this.seq }
  }

  // The server or a seat put the player at `sample` (spawn, snap back, sit, stand). Moves sent before it no
  // longer count: their rejects carry an older position and are ignored.
  reset(sample: MoveSample): void {
    this.last = { ...sample }
    this.ignoreRejectsUpTo = this.seq
  }

  // True when a move:reject for `seq` should snap the player back.
  shouldApplyReject(seq: number): boolean {
    return seq > this.ignoreRejectsUpTo && seq <= this.seq
  }
}
