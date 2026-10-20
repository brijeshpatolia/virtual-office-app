import type { MessageContext } from '@colyseus/core'
import type { ChosenStatus, ServerMessages } from '@vo/shared'
import type { Services } from '../../chat/services.ts'
import type { OfficeClient, RoomAuth } from '../OfficeRoom.ts'
import type { Player } from '../state.ts'

// What the chat, presence and admin handlers use from their OfficeRoom.
export interface HandlerContext {
  // undefined in room tests that do not need them; the handlers then reject chat, block and admin requests with
  // 'invalid' and drop waves (blocks cannot be checked). status:set still works, without saving the status text.
  readonly services: Services | undefined
  // The joined user behind a client, with the current role; null when the client has no session.
  userOf(client: OfficeClient): RoomAuth | null
  // The player of a user in this room; client is null while the room waits for a dropped client to reconnect.
  playerOf(userId: string): { player: Player; client: OfficeClient | null } | null
  // Sets the chosen status (and the status text, when given) of the client's player, counts as activity and
  // updates the effective status. null when the client has no session.
  setStatus(client: OfficeClient, chosen: ChosenStatus, statusText: string | undefined): Player | null
  broadcast<K extends keyof ServerMessages>(type: K, payload: ServerMessages[K], except?: OfficeClient): void
  // Ends the user's session with ROOM_CLOSE.kicked; false when the user is not in the room.
  kick(userId: string): boolean
  // Called (and awaited) when the room is disposed, e.g. to flush coalesced writes.
  onDispose(task: () => Promise<void>): void
  now(): number
}

// A handler for room.onMessage(type, handler). Sends ignore ctx; requests answer with a value or ctx.reject(reason).
export type RoomHandler = (client: OfficeClient, message: unknown, ctx: MessageContext) => unknown
export type RoomHandlers = Record<string, RoomHandler>

// OfficeRoom has onUncaughtException, so Colyseus swallows a handler's error and would answer the request with OK
// and no value. These wrappers log it instead and answer 'invalid' (requests) or drop the message (sends); the
// error never reaches the client.
export function request(type: string, handler: RoomHandler): RoomHandler {
  return async (client, message, ctx) => {
    try {
      return await handler(client, message, ctx)
    } catch (error) {
      console.error(`OfficeRoom: ${type} failed:`, error)
      return ctx.reject('invalid')
    }
  }
}

export function send(type: string, handler: (client: OfficeClient, message: unknown) => unknown): RoomHandler {
  return async (client, message) => {
    try {
      await handler(client, message)
    } catch (error) {
      console.error(`OfficeRoom: ${type} failed:`, error)
    }
  }
}
