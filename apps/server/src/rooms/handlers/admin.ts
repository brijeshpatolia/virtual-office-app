import { MSG } from '@vo/shared'
import type { HandlerContext, RoomHandlers } from './context.ts'

// admin:mute and admin:kick (requests), for owners and admins.
export function adminHandlers(room: HandlerContext): RoomHandlers {
  void room
  return {
    [MSG.adminMute]: (_client, _message, ctx) => ctx.reject('invalid'),
    [MSG.adminKick]: (_client, _message, ctx) => ctx.reject('invalid'),
  }
}
