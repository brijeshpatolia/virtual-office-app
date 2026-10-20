import type { MessageContext } from '@colyseus/core'
import type { Services } from '../../chat/services.ts'
import type { OfficeClient, RoomAuth } from '../OfficeRoom.ts'

// What the chat, presence and admin handlers use from their OfficeRoom.
export interface HandlerContext {
  // undefined in room tests that do not need them; the handlers then reject every request with 'invalid'.
  readonly services: Services | undefined
  // The joined user behind a client, with the current role; null when the client has no session.
  userOf(client: OfficeClient): RoomAuth | null
  now(): number
}

// A handler for room.onMessage(type, handler). Sends ignore ctx; requests answer with a value or ctx.reject(reason).
export type RoomHandler = (client: OfficeClient, message: unknown, ctx: MessageContext) => unknown
export type RoomHandlers = Record<string, RoomHandler>
