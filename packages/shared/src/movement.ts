import type { Grid } from './grid.ts'
import type { MoveRejectReason } from './protocol/messages.ts'
import type { Point } from './types.ts'

// Server move checks, shared so the client can predict the same verdict. Owned by the realtime work (P1a).
export type MoveVerdict = { ok: true } | { ok: false; reason: Extract<MoveRejectReason, 'speed' | 'collision'> }

// from/to are sprite-centre positions; elapsedMs is the time since the last accepted move.
export function checkMove(walkGrid: Grid, from: Point, to: Point, elapsedMs: number): MoveVerdict {
  void [walkGrid, from, to, elapsedMs]
  throw new Error('Not implemented: checkMove')
}
