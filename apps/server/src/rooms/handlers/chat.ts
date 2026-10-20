import { MSG } from '@vo/shared'
import type { HandlerContext, RoomHandlers } from './context.ts'

// chat:send, chat:delete (requests) and chat:read (send). Server step: validate, call room.services.chat, broadcast
// chat:new (except to the author) and chat:deleted.
export function chatHandlers(room: HandlerContext): RoomHandlers {
  void room
  return {
    [MSG.chatSend]: (_client, _message, ctx) => ctx.reject('invalid'),
    [MSG.chatDelete]: (_client, _message, ctx) => ctx.reject('invalid'),
    [MSG.chatRead]: () => undefined,
  }
}
