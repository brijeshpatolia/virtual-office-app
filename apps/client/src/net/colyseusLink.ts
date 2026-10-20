import { Callbacks, Client, type Room } from '@colyseus/sdk'
import type { IRef } from '@colyseus/schema'
import {
  MoveRejectSchema,
  MSG,
  ROOM_NAME,
  SitResponseSchema,
  StandResponseSchema,
  type JoinOptions,
  type OfficeStateView,
  type PlayerState,
} from '@vo/shared'
import { colyseusEndpoint } from '../api/serverUrl.ts'
import type { JoinOffice, OfficeConnectionHandle, OfficeLink } from './officeLink.ts'

// The synced state as Colyseus decodes it: Schema refs, so the callback API accepts them.
type Synced<T> = IRef & {
  readonly [K in keyof T]: T[K] extends ReadonlyMap<infer Key, infer V> ? ReadonlyMap<Key, Synced<V>> & IRef : T[K]
}
type SyncedState = Synced<OfficeStateView>
type SyncedPlayer = Synced<PlayerState>
type OfficeRoom = Room<unknown, SyncedState>

// The SDK also puts the token into the WebSocket URL (_authToken), where proxies log it. The room checks it only
// in the matchmaking request (static onAuth), so the URL goes without it.
export function withoutAuthToken(url: URL): string {
  url.searchParams.delete('_authToken')
  return url.toString()
}

// Joins the office room with the realtime token (sent as Authorization: Bearer during matchmaking; onAuth checks
// it). Rejects with MatchMakeError (code 525 = not allowed) or a network error.
export const joinColyseusOffice: JoinOffice = async (officeId, token) => {
  const client = new Client(colyseusEndpoint(), { urlBuilder: withoutAuthToken })
  client.auth.token = token
  const options: JoinOptions = { officeId }
  const room = await client.joinOrCreate<SyncedState>(ROOM_NAME, options)
  return wrapRoom(room)
}

const EMPTY = new Map<never, never>()

function wrapRoom(room: OfficeRoom): OfficeConnectionHandle {
  const callbacks = Callbacks.get(room)
  const link: OfficeLink = {
    sessionId: room.sessionId,
    // joinOrCreate resolves before the first state patch; until then the collections are missing.
    get state() {
      const state = room.state as Partial<SyncedState> | undefined
      return { players: state?.players ?? EMPTY, seats: state?.seats ?? EMPTY }
    },
    onPlayerAdd: (handler) => callbacks.onAdd('players', (player, sessionId) => handler(player, sessionId)),
    onPlayerRemove: (handler) => callbacks.onRemove('players', (player, sessionId) => handler(player, sessionId)),
    onPlayerChange: (player, handler) => callbacks.onChange(player as SyncedPlayer, handler),
    onMoveReject: (handler) =>
      room.onMessage(MSG.moveReject, (payload: unknown) => {
        const parsed = MoveRejectSchema.safeParse(payload)
        if (parsed.success) handler(parsed.data)
      }),
    // While the connection is down the SDK would queue moves and replay them after the reconnect; drop them instead.
    sendMove: (move) => {
      if (room.connection.isOpen) room.send(MSG.move, move)
    },
    sendActivity: (activity) => room.send(MSG.activity, activity),
    sit: async (seatId) => SitResponseSchema.parse(await room.request(MSG.sit, { seatId })),
    stand: async () => StandResponseSchema.parse(await room.request(MSG.stand, {})),
  }
  return {
    link,
    onDrop: (handler) => subscribe(room.onDrop, handler),
    onReconnect: (handler) => subscribe(room.onReconnect, handler),
    onLeave: (handler) => subscribe(room.onLeave, handler),
    leave: async () => {
      await room.leave(true)
    },
  }
}

interface Signal<F> {
  (cb: F): unknown
  remove(cb: F): void
}

function subscribe<F>(signal: Signal<F>, handler: F): () => void {
  signal(handler)
  return () => signal.remove(handler)
}
