import type { Db } from '@vo/db'
import type {
  ChatDeleteRejectReason,
  ChatHistoryQuery,
  ChatHistoryResponse,
  ChatMessage,
  ChatSendRejectReason,
  ChatSendRequest,
  ChatUnreadResponse,
  OrgRole,
} from '@vo/shared'
import { notImplemented } from '../notImplemented.ts'
import type { PrefsService } from '../presence/prefs.ts'
import type { Moderation } from './moderation.ts'

// The office a chat call is about; orgId is the office's company (from the room auth or getOfficeAccess).
export interface ChatScope {
  orgId: string
  officeId: string
}

export interface ChatUser {
  userId: string
  role: OrgRole
}

export interface ChatAuthor extends ChatUser {
  // The name in the room (the realtime token's name claim).
  name: string
}

export type ChatSendResult = { ok: true; message: ChatMessage; created: boolean } | { ok: false; reason: ChatSendRejectReason }
export type ChatDeleteResult = { ok: true } | { ok: false; reason: ChatDeleteRejectReason }

// The office chat, for the room handlers and the /api routes. Every query goes through forOrg(scope.orgId).
export interface ChatService {
  // chat:send. Checks (protocol/chat.ts order), stores the message and its mentions, and answers it. The caller
  // broadcasts 'chat:new' only when created is true. A guest's everyone token becomes text (withoutEveryone).
  // Mentions notify members other than the author with no block between the two (prefs.blockedBetween).
  // The rate limit (CHAT_RATE_LIMIT, sliding window per company and user) lives in this service's memory.
  send(scope: ChatScope, author: ChatAuthor, request: ChatSendRequest): Promise<ChatSendResult>
  // GET /api/offices/:officeId/chat. A guest gets only the messages since their member.createdAt.
  list(scope: ChatScope, viewer: ChatUser, query: ChatHistoryQuery): Promise<ChatHistoryResponse>
  // chat:delete: the author, or an owner or admin (audit entry 'chat.delete' when it is not the author).
  delete(scope: ChatScope, actor: ChatUser, messageId: string): Promise<ChatDeleteResult>
  // chat:read. Only moves forward; an id that is not a message of the office is ignored.
  markRead(scope: ChatScope, userId: string, lastReadId: string): Promise<void>
  // GET /api/offices/:officeId/chat/unread.
  unread(scope: ChatScope, viewer: ChatUser): Promise<ChatUnreadResponse>
}

export function createChatService(deps: { db: Db; prefs: PrefsService; moderation: Moderation; now?: () => number }): ChatService {
  void deps
  return {
    send: () => notImplemented('ChatService.send'),
    list: () => notImplemented('ChatService.list'),
    delete: () => notImplemented('ChatService.delete'),
    markRead: () => notImplemented('ChatService.markRead'),
    unread: () => notImplemented('ChatService.unread'),
  }
}
