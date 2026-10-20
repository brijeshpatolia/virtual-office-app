import {
  BlockSetRequestSchema,
  MSG,
  StatusSetRequestSchema,
  WAVE_RATE_LIMIT,
  WaveSchema,
  type BlockSetResponse,
  type StatusSetResponse,
} from '@vo/shared'
import { createSlidingWindow } from '../../chat/slidingWindow.ts'
import { createThrottledWriter } from '../throttledWriter.ts'
import { request, send, type HandlerContext, type RoomHandlers } from './context.ts'

// status:set and block:set (requests) and wave (send).
export function presenceHandlers(room: HandlerContext): RoomHandlers {
  // The status text is saved in the user's prefs (write on change, coalesced). The room passes itself as the
  // origin, so its own prefs listener does not set an older text back while a newer one waits to be written.
  const statusTexts = createThrottledWriter<{ orgId: string; statusText: string }>({
    name: MSG.statusSet,
    write: async (userId, { orgId, statusText }) => {
      await room.services?.prefs.update(orgId, userId, { statusText }, room)
    },
  })
  room.onDispose(() => statusTexts.flush())
  // A rejoin right after a change must read the new text, not the one before it.
  room.beforeJoin((userId) => statusTexts.flushKey(userId))
  const waves = createSlidingWindow(WAVE_RATE_LIMIT.waves, WAVE_RATE_LIMIT.windowMs)
  const pairs = createSlidingWindow(1, WAVE_RATE_LIMIT.perTargetMs)

  return {
    [MSG.statusSet]: request(MSG.statusSet, (client, message, ctx) => {
      const auth = room.userOf(client)
      const parsed = StatusSetRequestSchema.safeParse(message)
      const before = auth === null ? undefined : room.playerOf(auth.userId)?.player.statusText
      if (auth === null || !parsed.success || before === undefined) return ctx.reject('invalid')
      const player = room.setStatus(client, parsed.data.status, parsed.data.statusText)
      if (player === null) return ctx.reject('invalid')
      if (player.statusText !== before) statusTexts.push(auth.userId, { orgId: auth.orgId, statusText: player.statusText })
      return { ok: true, status: player.chosenStatus, statusText: player.statusText } satisfies StatusSetResponse
    }),

    [MSG.blockSet]: request(MSG.blockSet, async (client, message, ctx) => {
      const auth = room.userOf(client)
      const parsed = BlockSetRequestSchema.safeParse(message)
      const prefs = room.services?.prefs
      if (auth === null || !parsed.success || prefs === undefined) return ctx.reject('invalid')
      const result = await prefs.setBlocked(auth.orgId, auth.userId, parsed.data.userId, parsed.data.blocked)
      if (!result.ok) return ctx.reject(result.reason)
      return { ok: true, blockedUserIds: result.prefs.blockedUserIds } satisfies BlockSetResponse
    }),

    // Dropped silently (the sender never learns why): no such player in the room, self, the target is on DND, a
    // block either way, or over WAVE_RATE_LIMIT. Delivered only to the target's client.
    [MSG.wave]: send(MSG.wave, async (client, message) => {
      const auth = room.userOf(client)
      const parsed = WaveSchema.safeParse(message)
      const prefs = room.services?.prefs
      if (auth === null || !parsed.success || prefs === undefined) return
      const targetId = parsed.data.targetUserId
      const target = room.playerOf(targetId)
      if (targetId === auth.userId || target === null || target.player.chosenStatus === 'dnd') return
      const at = room.now()
      const pair = pairs.take(`${auth.userId}/${targetId}`, at)
      if (pair === null) return
      if (waves.take(auth.userId, at) === null) {
        pair()
        return
      }
      if ((await prefs.blockedBetween(auth.orgId, auth.userId, [targetId])).size > 0) return
      // Read again: the target may have left, reconnected or turned on DND meanwhile.
      const recipient = room.playerOf(targetId)
      if (recipient === null || recipient.client === null || recipient.player.chosenStatus === 'dnd') return
      const fromName = room.playerOf(auth.userId)?.player.name ?? auth.name
      recipient.client.send(MSG.waveReceived, { fromUserId: auth.userId, fromName })
    }),
  }
}
