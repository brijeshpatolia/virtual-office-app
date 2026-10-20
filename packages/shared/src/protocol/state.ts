import type { Facing } from '../types.ts'

// The synced Colyseus state of an OfficeRoom, as the client reads it (room.state).
// The server defines the same fields as @colyseus/schema classes (apps/server/src/rooms/state.ts).

export const PLAYER_STATUSES = ['available', 'away'] as const
export type PlayerStatus = (typeof PLAYER_STATUSES)[number]

export interface PlayerState {
  readonly userId: string
  readonly name: string
  // '#rrggbb' from avatarColor(userId).
  readonly color: string
  // Sprite centre in world px. The feet point is y + FEET_OFFSET_Y.
  readonly x: number
  readonly y: number
  readonly dir: Facing
  readonly moving: boolean
  // The server's zone of the feet point; '' = no zone (doors, walls).
  readonly zoneId: string
  // '' = standing.
  readonly seatId: string
  readonly status: PlayerStatus
}

export interface SeatState {
  // userId of the person on the seat; '' = free.
  readonly occupantId: string
}

export interface OfficeStateView {
  // Key: Colyseus sessionId. The own player is players.get(room.sessionId).
  readonly players: ReadonlyMap<string, PlayerState>
  // Key: seatId from the map. Every seat of the map has an entry.
  readonly seats: ReadonlyMap<string, SeatState>
}
