import { z } from 'zod'
import { FACINGS } from '../types.ts'
import type {
  ChatDeleted,
  ChatDeleteRejectReason,
  ChatDeleteRequest,
  ChatDeleteResponse,
  ChatMessage,
  ChatMuted,
  ChatRead,
  ChatSendRejectReason,
  ChatSendRequest,
  ChatSendResponse,
} from './chat.ts'
import type {
  AdminKickRequest,
  AdminKickResponse,
  AdminMuteRequest,
  AdminMuteResponse,
  AdminRejectReason,
  BlockRejectReason,
  BlockSetRequest,
  BlockSetResponse,
  StatusSetRequest,
  StatusSetResponse,
  Wave,
  WaveReceived,
} from './presence.ts'

// Realtime messages of the 'office' room. zod checks every payload on the server.
// "send" = room.send / client.send (fire and forget). "request" = room.request(type, payload) on the client;
// the server handler returns the response or calls ctx.reject(reason).

const coord = z.number() // zod 4 rejects NaN and Infinity
const id = z.string().min(1).max(64)

export const FacingSchema = z.enum(FACINGS)

export const JoinOptionsSchema = z.object({ officeId: id })
export type JoinOptions = z.infer<typeof JoinOptionsSchema>

// Client to server, send. Position = sprite centre in world px; the feet point is y + FEET_OFFSET_Y.
// seq counts up by one per move of this session; move:reject echoes it.
export const MoveMessageSchema = z.object({
  x: coord,
  y: coord,
  dir: FacingSchema,
  moving: z.boolean(),
  seq: z.number().int().nonnegative(),
})
export type MoveMessage = z.infer<typeof MoveMessageSchema>

// Client to server, send. On input (throttled to ACTIVITY_REPORT_INTERVAL_MS) and at once on visibilitychange.
export const PresenceActivitySchema = z.object({ hidden: z.boolean() })
export type PresenceActivity = z.infer<typeof PresenceActivitySchema>

// Server to client. The server did not accept move `seq`; the client snaps to (x, y) and drops older predictions.
export const MOVE_REJECT_REASONS = ['speed', 'collision', 'seated', 'guest', 'full', 'locked', 'cooldown'] as const
export type MoveRejectReason = (typeof MOVE_REJECT_REASONS)[number]
export const MoveRejectSchema = z.object({
  x: coord,
  y: coord,
  seq: z.number().int().nonnegative(),
  reason: z.enum(MOVE_REJECT_REASONS),
})
export type MoveReject = z.infer<typeof MoveRejectSchema>

// Request 'seat:sit'. Needs a free seat within SIT_RADIUS of the feet point. On success the server puts the
// feet point on the seat (x = seat.x, y = seat.y - FEET_OFFSET_Y), turns the avatar to seat.facing and stops it.
export const SitRequestSchema = z.object({ seatId: id })
export type SitRequest = z.infer<typeof SitRequestSchema>
export const SitResponseSchema = z.object({ ok: z.literal(true), seatId: z.string(), x: coord, y: coord, dir: FacingSchema })
export type SitResponse = z.infer<typeof SitResponseSchema>
export const SIT_REJECT_REASONS = ['taken', 'far', 'not_allowed', 'invalid'] as const
export type SitRejectReason = (typeof SIT_REJECT_REASONS)[number]

// Request 'seat:stand'. Always ok for a player in the room ('invalid' otherwise). The avatar stays where it sat when its body fits there; otherwise the server
// moves it to the nearest free spot. (x, y) is where it stands (sprite centre).
export const StandRequestSchema = z.object({})
export type StandRequest = z.infer<typeof StandRequestSchema>
export const StandResponseSchema = z.object({ ok: z.literal(true), x: coord, y: coord })
export type StandResponse = z.infer<typeof StandResponseSchema>

// Chat, status, waves, blocks and moderation: schemas in chat.ts and presence.ts.
export const MSG = {
  move: 'move',
  moveReject: 'move:reject',
  sit: 'seat:sit',
  stand: 'seat:stand',
  activity: 'presence:activity',
  chatSend: 'chat:send',
  chatNew: 'chat:new',
  chatDelete: 'chat:delete',
  chatDeleted: 'chat:deleted',
  chatRead: 'chat:read',
  chatMuted: 'chat:muted',
  statusSet: 'status:set',
  wave: 'wave',
  waveReceived: 'wave:received',
  blockSet: 'block:set',
  adminMute: 'admin:mute',
  adminKick: 'admin:kick',
} as const

export interface ClientMessages {
  [MSG.move]: MoveMessage
  [MSG.activity]: PresenceActivity
  [MSG.chatRead]: ChatRead
  [MSG.wave]: Wave
}

export interface ServerMessages {
  [MSG.moveReject]: MoveReject
  [MSG.chatNew]: ChatMessage
  [MSG.chatDeleted]: ChatDeleted
  [MSG.chatMuted]: ChatMuted
  [MSG.waveReceived]: WaveReceived
}

export interface RoomRequests {
  [MSG.sit]: { request: SitRequest; response: SitResponse; reject: SitRejectReason }
  [MSG.stand]: { request: StandRequest; response: StandResponse; reject: 'invalid' }
  [MSG.chatSend]: { request: ChatSendRequest; response: ChatSendResponse; reject: ChatSendRejectReason }
  [MSG.chatDelete]: { request: ChatDeleteRequest; response: ChatDeleteResponse; reject: ChatDeleteRejectReason }
  [MSG.statusSet]: { request: StatusSetRequest; response: StatusSetResponse; reject: 'invalid' }
  [MSG.blockSet]: { request: BlockSetRequest; response: BlockSetResponse; reject: BlockRejectReason }
  [MSG.adminMute]: { request: AdminMuteRequest; response: AdminMuteResponse; reject: AdminRejectReason }
  [MSG.adminKick]: { request: AdminKickRequest; response: AdminKickResponse; reject: AdminRejectReason }
}

// @colyseus/sdk rejects room.request() with an Error named 'rejected' whose `reason` is the ctx.reject() value.
export function rejectReason(error: unknown): string | null {
  if (!(error instanceof Error) || error.name !== 'rejected' || !('reason' in error)) return null
  return typeof error.reason === 'string' ? error.reason : null
}
