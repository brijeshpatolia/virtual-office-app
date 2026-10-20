import {
  ChatDeleteRequestSchema,
  ChatReadSchema,
  ChatSendRequestSchema,
  MSG,
  type ChatDeleteResponse,
  type ChatSendResponse,
} from '@vo/shared'
import { createThrottledWriter } from '../throttledWriter.ts'
import { request, send, type HandlerContext, type RoomHandlers } from './context.ts'

interface ReadMarks {
  orgId: string
  officeId: string
  // The newest ids a client sent within one write interval, newest first; the write keeps the first that is a
  // message of the office, so one bogus id does not hide a real one.
  ids: string[]
}

const READ_CANDIDATES = 3

// chat:send, chat:delete (requests) and chat:read (send). The message is stored before 'chat:new' goes out, so a
// failed write broadcasts nothing; a retried clientMsgId answers the stored message and broadcasts nothing.
export function chatHandlers(room: HandlerContext): RoomHandlers {
  // Message ids are lowercase uuidv7 here, so the greater string is the newer message.
  const reads = createThrottledWriter<ReadMarks>({
    name: MSG.chatRead,
    merge: (pending, next) => ({
      ...next,
      ids: [...new Set([...pending.ids, ...next.ids])].sort().reverse().slice(0, READ_CANDIDATES),
    }),
    write: async (userId, marks) => {
      for (const id of marks.ids) if (await room.services?.chat.markRead(marks, userId, id)) return
    },
  })
  room.onDispose(() => reads.flush())

  return {
    [MSG.chatSend]: request(MSG.chatSend, async (client, message, ctx) => {
      const auth = room.userOf(client)
      const parsed = ChatSendRequestSchema.safeParse(message)
      const chat = room.services?.chat
      if (auth === null || !parsed.success || chat === undefined) return ctx.reject('invalid')
      const result = await chat.send(auth, auth, parsed.data)
      if (!result.ok) {
        if (result.mutedUntil !== undefined) client.send(MSG.chatMuted, { until: result.mutedUntil.toISOString() })
        return ctx.reject(result.reason)
      }
      if (result.created) room.broadcast(MSG.chatNew, result.message, client)
      return { ok: true, message: result.message } satisfies ChatSendResponse
    }),

    [MSG.chatDelete]: request(MSG.chatDelete, async (client, message, ctx) => {
      const auth = room.userOf(client)
      const parsed = ChatDeleteRequestSchema.safeParse(message)
      const chat = room.services?.chat
      if (auth === null || !parsed.success || chat === undefined) return ctx.reject('invalid')
      const result = await chat.delete(auth, auth, parsed.data.id)
      if (!result.ok) return ctx.reject(result.reason)
      room.broadcast(MSG.chatDeleted, { id: parsed.data.id.toLowerCase() })
      return { ok: true } satisfies ChatDeleteResponse
    }),

    [MSG.chatRead]: send(MSG.chatRead, (client, message) => {
      const auth = room.userOf(client)
      const parsed = ChatReadSchema.safeParse(message)
      if (auth === null || !parsed.success || room.services === undefined) return
      reads.push(auth.userId, { orgId: auth.orgId, officeId: auth.officeId, ids: [parsed.data.lastReadId.toLowerCase()] })
    }),
  }
}
