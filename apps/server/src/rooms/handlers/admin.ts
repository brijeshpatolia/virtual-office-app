import { AdminKickRequestSchema, AdminMuteRequestSchema, MSG, type AdminKickResponse, type AdminMuteResponse } from '@vo/shared'
import { request, type HandlerContext, type RoomHandlers } from './context.ts'

// admin:mute and admin:kick (requests), for owners and admins on a lower role (Moderation reads both roles from the
// database).
export function adminHandlers(room: HandlerContext): RoomHandlers {
  return {
    [MSG.adminMute]: request(MSG.adminMute, async (client, message, ctx) => {
      const auth = room.userOf(client)
      const parsed = AdminMuteRequestSchema.safeParse(message)
      const moderation = room.services?.moderation
      if (auth === null || !parsed.success || moderation === undefined) return ctx.reject('invalid')
      const result = await moderation.mute(auth.orgId, auth, parsed.data.userId, parsed.data.minutes)
      if (!result.ok) return ctx.reject(result.reason)
      const until = result.until?.toISOString() ?? null
      room.playerOf(parsed.data.userId)?.client?.send(MSG.chatMuted, { until })
      return { ok: true, until } satisfies AdminMuteResponse
    }),

    // not_found: the target is not in this office room (after the permission check, so members learn nothing).
    // The audit entry is written first, so every kick has one.
    [MSG.adminKick]: request(MSG.adminKick, async (client, message, ctx) => {
      const auth = room.userOf(client)
      const parsed = AdminKickRequestSchema.safeParse(message)
      const moderation = room.services?.moderation
      if (auth === null || !parsed.success || moderation === undefined) return ctx.reject('invalid')
      const target = parsed.data.userId
      const allowed = await moderation.authorizeKick(auth.orgId, auth, target)
      if (!allowed.ok) return ctx.reject(allowed.reason)
      if (room.playerOf(target) === null) return ctx.reject('not_found')
      await moderation.recordKick(auth.orgId, auth, target, auth.officeId)
      if (!room.kick(target)) return ctx.reject('not_found')
      return { ok: true } satisfies AdminKickResponse
    }),
  }
}
