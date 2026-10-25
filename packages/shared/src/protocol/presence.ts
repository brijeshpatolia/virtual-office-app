import { z } from 'zod'
import { CHOSEN_STATUSES, type ChosenStatus, type PlayerStatus } from './state.ts'

const userId = z.string().min(1).max(64)
const isoDate = z.iso.datetime()

// PlayerState.status, what everyone sees: DND wins, then away (set by the server after idle time), then busy
// (chosen, or automatic while the feet point is in a zone with mediaMode 'room'), else available.
export function effectiveStatus(input: { chosen: ChosenStatus; away: boolean; inRoomZone: boolean }): PlayerStatus {
  if (input.chosen === 'dnd') return 'dnd'
  if (input.away) return 'away'
  return input.chosen === 'busy' || input.inRoomZone ? 'busy' : 'available'
}

// One line, at most STATUS_TEXT_MAX_LENGTH characters after trimming; '' = none.
export const STATUS_TEXT_MAX_LENGTH = 80
export const StatusTextSchema = z
  .string()
  .trim()
  .max(STATUS_TEXT_MAX_LENGTH)
  .regex(/^[^\p{Cc}]*$/u, 'no control characters')

// Request 'status:set'. The chosen status lasts for the session (a new join starts at 'available'); the status
// text is saved in the user's prefs for this company and comes back at the next join. statusText omitted = unchanged.
export const StatusSetRequestSchema = z.object({ status: z.enum(CHOSEN_STATUSES), statusText: StatusTextSchema.optional() })
export type StatusSetRequest = z.infer<typeof StatusSetRequestSchema>
export const StatusSetResponseSchema = z.object({ ok: z.literal(true), status: z.enum(CHOSEN_STATUSES), statusText: z.string() })
export type StatusSetResponse = z.infer<typeof StatusSetResponseSchema>

// Client to server, send 'wave'. The target gets 'wave:received' when it is in the room, is not on DND, neither
// of the two blocked the other, and the sender is within WAVE_RATE_LIMIT. Otherwise the wave is dropped
// silently: the sender never learns why.
export const WAVE_RATE_LIMIT = { waves: 3, windowMs: 30_000, perTargetMs: 10_000 } as const
export const WaveSchema = z.object({ targetUserId: userId })
export type Wave = z.infer<typeof WaveSchema>
export const WaveReceivedSchema = z.object({ fromUserId: z.string(), fromName: z.string() })
export type WaveReceived = z.infer<typeof WaveReceivedSchema>

// Request 'block:set'. Blocking works in both directions: the blocker's client hides the blocked person's
// messages, and no mention notification or wave goes between them (P3: no media either). Blocking needs a
// current member of the company; unblocking always works. Never yourself; at most MAX_BLOCKED_USERS.
export const MAX_BLOCKED_USERS = 500
export const BlockSetRequestSchema = z.object({ userId, blocked: z.boolean() })
export type BlockSetRequest = z.infer<typeof BlockSetRequestSchema>
export const BlockSetResponseSchema = z.object({ ok: z.literal(true), blockedUserIds: z.array(z.string()) })
export type BlockSetResponse = z.infer<typeof BlockSetResponseSchema>
export const BLOCK_REJECT_REASONS = ['not_found', 'invalid'] as const
export type BlockRejectReason = (typeof BLOCK_REJECT_REASONS)[number]

// Requests 'admin:mute' and 'admin:kick', for owners and admins. They act only on someone with a lower role
// (owner > admin > member > guest), never on themselves. A mute is company-wide and stops chat:send until it ends;
// minutes 0 unmutes. A kick closes the target's connection with ROOM_CLOSE.kicked; the membership stays.
export const MUTE_MAX_MINUTES = 7 * 24 * 60
export const AdminMuteRequestSchema = z.object({ userId, minutes: z.number().int().min(0).max(MUTE_MAX_MINUTES) })
export type AdminMuteRequest = z.infer<typeof AdminMuteRequestSchema>
export const AdminMuteResponseSchema = z.object({ ok: z.literal(true), until: isoDate.nullable() })
export type AdminMuteResponse = z.infer<typeof AdminMuteResponseSchema>
export const AdminKickRequestSchema = z.object({ userId })
export type AdminKickRequest = z.infer<typeof AdminKickRequestSchema>
export const AdminKickResponseSchema = z.object({ ok: z.literal(true) })
export type AdminKickResponse = z.infer<typeof AdminKickResponseSchema>
// not_found: the target is not a member (mute), or not in the office (kick).
export const ADMIN_REJECT_REASONS = ['not_allowed', 'not_found', 'invalid'] as const
export type AdminRejectReason = (typeof ADMIN_REJECT_REASONS)[number]
