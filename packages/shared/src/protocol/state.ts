import type { Facing } from '../types.ts'

// The synced Colyseus state of an OfficeRoom, as the client reads it (room.state).
// The server defines the same fields as @colyseus/schema classes (apps/server/src/rooms/state.ts).

// What the user picks (request 'status:set'). 'away' is never picked: the server sets it after idle time.
export const CHOSEN_STATUSES = ['available', 'busy', 'dnd'] as const
export type ChosenStatus = (typeof CHOSEN_STATUSES)[number]
// What everyone sees: effectiveStatus() (presence.ts) of the chosen status, idleness and the zone.
export const PLAYER_STATUSES = ['available', 'busy', 'dnd', 'away'] as const
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
  // Effective status (the ring on the avatar and in the People panel).
  readonly status: PlayerStatus
  // The status the user picked, for their own status menu.
  readonly chosenStatus: ChosenStatus
  // Up to STATUS_TEXT_MAX_LENGTH characters; '' = none. From the user's prefs at join, then 'status:set'.
  readonly statusText: string
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
