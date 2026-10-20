import { Callbacks, Client, type Room } from '@colyseus/sdk'
import type { IRef } from '@colyseus/schema'
import {
  AdminKickResponseSchema,
  AdminMuteResponseSchema,
  BlockSetResponseSchema,
  ChatDeletedSchema,
  ChatDeleteResponseSchema,
  ChatMessageSchema,
  ChatMutedSchema,
  ChatSendResponseSchema,
  MoveRejectSchema,
  MSG,
  RoleChangedSchema,
  ROOM_NAME,
  SitResponseSchema,
  StandResponseSchema,
  StatusSetResponseSchema,
  WaveReceivedSchema,
  type JoinOptions,
  type OfficeStateView,
  type PlayerState,
} from '@vo/shared'
import { colyseusEndpoint } from '../api/serverUrl.ts'
import { RequestTimeoutError, type JoinOffice, type OfficeConnectionHandle, type OfficeLink, type Unsubscribe } from './officeLink.ts'

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

// A chat message that gets no answer in this time counts as not sent; the client may retry with the same clientMsgId.
export const CHAT_SEND_TIMEOUT_MS = 8000

// The SDK times a request out only while the socket stays open (a close rejects it at once with another error):
// such a request may have been handled, which a RequestTimeoutError tells the caller.
export function requestError(error: unknown, connectionOpen: boolean): unknown {
  const timedOut = error instanceof Error && error.name !== 'rejected' && / timed out /.test(error.message)
  return timedOut && connectionOpen ? new RequestTimeoutError(error.message) : error
}

interface Parser<T> {
  safeParse(data: unknown): { success: true; data: T } | { success: false }
}

// A server push, checked with its schema; payloads that do not match are dropped.
function listen<T>(room: OfficeRoom, type: string, schema: Parser<T>, handler: (payload: T) => void): Unsubscribe {
  return room.onMessage(type, (payload: unknown) => {
    const parsed = schema.safeParse(payload)
    if (parsed.success) handler(parsed.data)
  })
}

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
    onMoveReject: (handler) => listen(room, MSG.moveReject, MoveRejectSchema, handler),
    // While the connection is down the SDK would queue moves and replay them after the reconnect; drop them instead.
    sendMove: (move) => {
      if (room.connection.isOpen) room.send(MSG.move, move)
    },
    sendActivity: (activity) => room.send(MSG.activity, activity),
    sit: async (seatId) => SitResponseSchema.parse(await room.request(MSG.sit, { seatId })),
    stand: async () => StandResponseSchema.parse(await room.request(MSG.stand, {})),
    sendChat: async (request) => {
      try {
        return ChatSendResponseSchema.parse(await room.request(MSG.chatSend, request, { timeout: CHAT_SEND_TIMEOUT_MS })).message
      } catch (error) {
        throw requestError(error, room.connection.isOpen)
      }
    },
    deleteChat: async (id) => {
      ChatDeleteResponseSchema.parse(await room.request(MSG.chatDelete, { id }))
    },
    markChatRead: (lastReadId) => {
      if (!room.connection.isOpen) return false
      room.send(MSG.chatRead, { lastReadId })
      return true
    },
    onChatNew: (handler) => listen(room, MSG.chatNew, ChatMessageSchema, handler),
    onChatDeleted: (handler) => listen(room, MSG.chatDeleted, ChatDeletedSchema, handler),
    onChatMuted: (handler) => listen(room, MSG.chatMuted, ChatMutedSchema, handler),
    setStatus: async (request) => StatusSetResponseSchema.parse(await room.request(MSG.statusSet, request)),
    // A wave queued while offline would arrive late and out of context; drop it.
    wave: (targetUserId) => {
      if (room.connection.isOpen) room.send(MSG.wave, { targetUserId })
    },
    onWaveReceived: (handler) => listen(room, MSG.waveReceived, WaveReceivedSchema, handler),
    setBlocked: async (userId, blocked) =>
      BlockSetResponseSchema.parse(await room.request(MSG.blockSet, { userId, blocked })).blockedUserIds,
    mute: async (userId, minutes) => AdminMuteResponseSchema.parse(await room.request(MSG.adminMute, { userId, minutes })).until,
    kick: async (userId) => {
      AdminKickResponseSchema.parse(await room.request(MSG.adminKick, { userId }))
    },
    onRoleChanged: (handler) => listen(room, MSG.roleChanged, RoleChangedSchema, handler),
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
