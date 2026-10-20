import type { Db } from '@vo/db'
import type { AdminRejectReason, OrgRole } from '@vo/shared'
import { notImplemented } from '../notImplemented.ts'

export interface Actor {
  userId: string
  role: OrgRole
}

const RANK: Record<OrgRole, number> = { owner: 3, admin: 2, member: 1, guest: 0 }

// Owners and admins act only on someone with a lower role, and never on themselves.
export function canModerate(actor: Actor, target: Actor): boolean {
  return actor.userId !== target.userId && RANK[actor.role] >= RANK.admin && RANK[actor.role] > RANK[target.role]
}

export type ModerationResult<T extends object = object> = ({ ok: true } & T) | { ok: false; reason: AdminRejectReason }

// Chat mutes (chat_mutes, company-wide) and the permission check for kicks. Each action writes an audit_log entry
// ('chat.mute', 'chat.unmute', 'office.kick'). The target's role comes from the database, not from the room.
export interface Moderation {
  // minutes 0 unmutes (until null). 'not_found': the target is not a member.
  mute(orgId: string, actor: Actor, targetUserId: string, minutes: number): Promise<ModerationResult<{ until: Date | null }>>
  // The end of the user's mute; null when not muted. Asked on every chat:send, so it may cache (and must drop
  // its entry when mute() changes it).
  mutedUntil(orgId: string, userId: string): Promise<Date | null>
  // May actor kick targetUserId? The room then closes the target's connection with ROOM_CLOSE.kicked.
  authorizeKick(orgId: string, actor: Actor, targetUserId: string): Promise<ModerationResult>
}

export function createModeration(deps: { db: Db; now?: () => number }): Moderation {
  void deps
  return {
    mute: () => notImplemented('Moderation.mute'),
    mutedUntil: () => notImplemented('Moderation.mutedUntil'),
    authorizeKick: () => notImplemented('Moderation.authorizeKick'),
  }
}
