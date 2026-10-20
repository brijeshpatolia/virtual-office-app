import {
  ROOM_CLOSE,
  type ChatDeleted,
  type ChatMessage,
  type ChatMuted,
  type ChatSendRequest,
  type MoveMessage,
  type MoveReject,
  type OfficeStateView,
  type PlayerState,
  type PresenceActivity,
  type SitResponse,
  type StandResponse,
  type StatusSetRequest,
  type StatusSetResponse,
  type WaveReceived,
} from '@vo/shared'

export type Unsubscribe = () => void

// What the office scene and the HUD need from the realtime room. colyseusLink.ts wraps the Colyseus room;
// mockOffice.ts is a dev-only stand-in for the server. The state objects are live: the link mutates them in place.
// Requests reject with an Error that rejectReason() reads (the reasons in RoomRequests), or with another Error when
// the connection is down or the answer is late.
export interface OfficeLink {
  readonly sessionId: string
  readonly state: OfficeStateView
  // Also called for the players that are already there.
  onPlayerAdd(handler: (player: PlayerState, sessionId: string) => void): Unsubscribe
  onPlayerRemove(handler: (player: PlayerState, sessionId: string) => void): Unsubscribe
  // Once per server patch that changed this player.
  onPlayerChange(player: PlayerState, handler: () => void): Unsubscribe
  onMoveReject(handler: (reject: MoveReject) => void): Unsubscribe
  sendMove(move: MoveMessage): void
  sendActivity(activity: PresenceActivity): void
  // 'taken', 'far', 'not_allowed', 'invalid'.
  sit(seatId: string): Promise<SitResponse>
  stand(): Promise<StandResponse>

  // Chat. The answer is the stored message; a retry with the same clientMsgId answers the same message.
  sendChat(request: ChatSendRequest): Promise<ChatMessage>
  deleteChat(id: string): Promise<void>
  markChatRead(lastReadId: string): void
  onChatNew(handler: (message: ChatMessage) => void): Unsubscribe
  onChatDeleted(handler: (deleted: ChatDeleted) => void): Unsubscribe
  onChatMuted(handler: (muted: ChatMuted) => void): Unsubscribe

  // Presence and privacy.
  setStatus(request: StatusSetRequest): Promise<StatusSetResponse>
  wave(targetUserId: string): void
  onWaveReceived(handler: (wave: WaveReceived) => void): Unsubscribe
  // Resolves the new block list.
  setBlocked(userId: string, blocked: boolean): Promise<string[]>

  // Owners and admins. mute resolves the end of the mute (ISO), null when unmuted.
  mute(userId: string, minutes: number): Promise<string | null>
  kick(userId: string): Promise<void>
}

// A joined room, plus its lifecycle.
export interface OfficeConnectionHandle {
  readonly link: OfficeLink
  // The connection dropped; the SDK tries to reconnect (same session) for up to RECONNECT_SECONDS.
  onDrop(handler: () => void): Unsubscribe
  onReconnect(handler: () => void): Unsubscribe
  // The room is gone for good (code = WebSocket close code).
  onLeave(handler: (code: number) => void): Unsubscribe
  leave(): Promise<void>
}

export type JoinOffice = (officeId: string, token: string) => Promise<OfficeConnectionHandle>

export type LeaveReason = 'left' | 'replaced' | 'removed' | 'role_changed' | 'kicked' | 'lost'

// Colyseus: 4000 = we left (consented). ROOM_CLOSE codes come from our server. Anything else: the connection
// is lost (server shutdown 4001, failed reconnection 4003, too short uptime for a reconnect, errors).
export function leaveReason(code: number): LeaveReason {
  if (code === 4000) return 'left'
  if (code === ROOM_CLOSE.replaced) return 'replaced'
  if (code === ROOM_CLOSE.removed) return 'removed'
  if (code === ROOM_CLOSE.roleChanged) return 'role_changed'
  if (code === ROOM_CLOSE.kicked) return 'kicked'
  return 'lost'
}
