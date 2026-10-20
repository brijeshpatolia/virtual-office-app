import { forOrg, type Db } from '@vo/db'
import { MUTE_MAX_MINUTES, type AdminRejectReason, type OrgRole } from '@vo/shared'
import { toOrgRole } from '../auth/access.ts'

export interface Actor {
  userId: string
  role: OrgRole
}

const RANK: Record<OrgRole, number> = { owner: 3, admin: 2, member: 1, guest: 0 }

export const isModerator = (role: OrgRole): boolean => RANK[role] >= RANK.admin

// Owners and admins act only on someone with a lower role, and never on themselves.
export function canModerate(actor: Actor, target: Actor): boolean {
  return actor.userId !== target.userId && isModerator(actor.role) && RANK[actor.role] > RANK[target.role]
}

export type ModerationResult<T extends object = object> = ({ ok: true } & T) | { ok: false; reason: AdminRejectReason }

// Chat mutes (chat_mutes, company-wide) and the permission check for kicks. Each action writes an audit_log entry
// ('chat.mute', 'chat.unmute', 'office.kick'). Both roles come from the database, not from the room (the room's
// copy of the actor's role can be up to ACCESS_RECHECK_MS old); actor.role is not trusted.
export interface Moderation {
  // minutes 0 unmutes (until null). 'not_found': the target is not a member.
  mute(orgId: string, actor: Actor, targetUserId: string, minutes: number): Promise<ModerationResult<{ until: Date | null }>>
  // The end of the user's mute; null when not muted. Asked on every chat:send, so it caches for MUTE_CACHE_MS
  // (mute() replaces the entry).
  mutedUntil(orgId: string, userId: string): Promise<Date | null>
  // May actor kick targetUserId? The room then closes the target's connection with ROOM_CLOSE.kicked and calls
  // recordKick.
  authorizeKick(orgId: string, actor: Actor, targetUserId: string): Promise<ModerationResult>
  recordKick(orgId: string, actor: Actor, targetUserId: string, officeId: string): Promise<void>
}

export const MUTE_CACHE_MS = 30_000
const MAX_CACHE_ENTRIES = 10_000

export function createModeration(deps: { db: Db; now?: () => number }): Moderation {
  const { db } = deps
  const now = deps.now ?? Date.now
  const cache = new Map<string, { until: Date | null; checkedAt: number }>()
  // Bumped by every mute, so a lookup that started before it does not store its stale answer.
  let generation = 0
  const keyOf = (orgId: string, userId: string) => `${orgId}/${userId}`

  const roleOf = async (orgId: string, userId: string): Promise<OrgRole | null> => {
    const found = await forOrg(db, orgId).findMember(userId)
    return found === null ? null : toOrgRole(found.role)
  }

  // A member who is not an owner or admin learns nothing about the target (always not_allowed).
  const check = async (orgId: string, actor: Actor, targetUserId: string): Promise<ModerationResult> => {
    const [actorRole, targetRole] = await Promise.all([roleOf(orgId, actor.userId), roleOf(orgId, targetUserId)])
    if (actorRole === null || !isModerator(actorRole)) return { ok: false, reason: 'not_allowed' }
    if (targetRole === null) return { ok: false, reason: 'not_found' }
    if (!canModerate({ userId: actor.userId, role: actorRole }, { userId: targetUserId, role: targetRole })) {
      return { ok: false, reason: 'not_allowed' }
    }
    return { ok: true }
  }

  return {
    async mute(orgId, actor, targetUserId, minutes) {
      if (!Number.isInteger(minutes) || minutes < 0 || minutes > MUTE_MAX_MINUTES) return { ok: false, reason: 'invalid' }
      const allowed = await check(orgId, actor, targetUserId)
      if (!allowed.ok) return allowed
      const at = now()
      const until = minutes === 0 ? null : new Date(at + minutes * 60_000)
      const tenant = forOrg(db, orgId)
      await tenant.setMute(targetUserId, until, actor.userId)
      generation += 1
      cache.set(keyOf(orgId, targetUserId), { until, checkedAt: at })
      await tenant.audit({
        actorId: actor.userId,
        action: until === null ? 'chat.unmute' : 'chat.mute',
        targetType: 'user',
        targetId: targetUserId,
        data: until === null ? {} : { minutes, until: until.toISOString() },
      })
      return { ok: true, until }
    },

    async mutedUntil(orgId, userId) {
      const key = keyOf(orgId, userId)
      const at = now()
      const hit = cache.get(key)
      const until =
        hit !== undefined && at - hit.checkedAt < MUTE_CACHE_MS ? hit.until : await lookup(key, orgId, userId, at)
      return until !== null && until.getTime() > at ? until : null
    },

    authorizeKick: check,

    async recordKick(orgId, actor, targetUserId, officeId) {
      await forOrg(db, orgId).audit({ actorId: actor.userId, action: 'office.kick', targetType: 'user', targetId: targetUserId, data: { officeId } })
    },
  }

  async function lookup(key: string, orgId: string, userId: string, at: number): Promise<Date | null> {
    const started = generation
    const until = await forOrg(db, orgId).mutedUntil(userId, new Date(at))
    if (started === generation) {
      if (cache.size >= MAX_CACHE_ENTRIES) cache.clear()
      cache.set(key, { until, checkedAt: at })
    }
    return until
  }
}
