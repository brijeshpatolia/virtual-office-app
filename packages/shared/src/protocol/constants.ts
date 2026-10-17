import { FEET_OFFSET_Y } from '../constants.ts'
import type { ZoneType } from '../types.ts'

// Colyseus room name. Join options: JoinOptions (messages.ts). Auth token: the JWT from GET /api/rt-token.
export const ROOM_NAME = 'office'
// In dev the browser reaches Colyseus at `${location.origin}${COLYSEUS_PATH}`; Vite strips the prefix.
export const COLYSEUS_PATH = '/colyseus'

// Movement, in world px and ms. The client predicts; the server checks each move against these.
export const MAX_SPEED = 160
// The server accepts up to SPEED_CAP x MAX_SPEED.
export const SPEED_CAP = 1.25
// While moving the client sends at most MOVE_RATE_HZ moves per second, plus one when it stops or turns.
export const MOVE_RATE_HZ = 10
export const MOVE_INTERVAL_MS = 1000 / MOVE_RATE_HZ
// Allowance for network jitter, added to the elapsed time between two accepted moves.
export const MOVE_JITTER_MS = 100
// The elapsed time counts at most this much, so standing still never buys a long jump.
export const MOVE_MAX_DT_MS = 250
// Room.maxMessagesPerSecond. Colyseus disconnects a client that sends more.
export const MAX_MESSAGES_PER_SECOND = 40

// Arcade body of the avatar, relative to its position (the sprite centre). The body centre is the feet point.
export const PLAYER_BODY = { w: 20, h: 12, offsetY: FEET_OFFSET_Y } as const

// Presence: away after AWAY_AFTER_MS without activity, or HIDDEN_AWAY_AFTER_MS with the tab hidden.
export const AWAY_AFTER_MS = 10 * 60_000
export const HIDDEN_AWAY_AFTER_MS = 5 * 60_000
// The client sends presence:activity at most this often on input; a visibility change goes out at once.
export const ACTIVITY_REPORT_INTERVAL_MS = 30_000

// Guests may enter only these zone types (and the no-zone cells such as doors). Others get move:reject 'guest'.
export const DEFAULT_GUEST_ZONE_TYPES: readonly ZoneType[] = ['lobby', 'meeting']

export const PATCH_RATE_MS = 100
// allowReconnection(client, RECONNECT_SECONDS) after a dropped connection.
export const RECONNECT_SECONDS = 30
// The realtime JWT lives 15 min; the client fetches a fresh one after ACCESS_TOKEN_REFRESH_MS.
export const ACCESS_TOKEN_TTL_MS = 15 * 60_000
export const ACCESS_TOKEN_REFRESH_MS = 10 * 60_000

// Close codes for client.leave(code). Colyseus uses 4000-4010 itself. The SDK does not reconnect on these.
export const ROOM_CLOSE = {
  // The same user joined the office again (another tab); the older session is closed.
  replaced: 4100,
  // The user lost access to the office (removed from the company).
  removed: 4101,
} as const
