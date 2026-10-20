import { MSG } from '@vo/shared'
import type { HandlerContext, RoomHandlers } from './context.ts'

// status:set and block:set (requests) and wave (send).
export function presenceHandlers(room: HandlerContext): RoomHandlers {
  void room
  return {
    [MSG.statusSet]: (_client, _message, ctx) => ctx.reject('invalid'),
    [MSG.blockSet]: (_client, _message, ctx) => ctx.reject('invalid'),
    [MSG.wave]: () => undefined,
  }
}
