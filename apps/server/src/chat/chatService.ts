import { forOrg, type ChatMessageRecord, type Db } from '@vo/db'
import {
  CHAT_MAX_LENGTH,
  CHAT_PAGE_SIZE,
  CHAT_RATE_LIMIT,
  ChatSendRequestSchema,
  MessageIdSchema,
  UNREAD_COUNT_LIMIT,
  normalizeChatBody,
  parseMentions,
  withoutEveryone,
  type ChatDeleteRejectReason,
  type ChatHistoryQuery,
  type ChatHistoryResponse,
  type ChatMessage,
  type ChatSendRejectReason,
  type ChatSendRequest,
  type ChatUnreadResponse,
  type OrgRole,
} from '@vo/shared'
import { toOrgRole } from '../auth/access.ts'
import { displayName } from '../http/routes.ts'
import type { PrefsService } from '../presence/prefs.ts'
import { isModerator, type Moderation } from './moderation.ts'
import { createSlidingWindow } from './slidingWindow.ts'

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
  // The name in the room (the realtime token's name claim). Messages carry displayName() of the user row instead,
  // so live messages and history show the same name.
  name: string
}

export type ChatSendResult =
  | { ok: true; message: ChatMessage; created: boolean }
  // mutedUntil: set with 'muted', so the room can tell the client until when.
  | { ok: false; reason: ChatSendRejectReason; mutedUntil?: Date }
export type ChatDeleteResult = { ok: true } | { ok: false; reason: ChatDeleteRejectReason }

// The office chat, for the room handlers and the /api routes. Every query goes through forOrg(scope.orgId), and every
// call reads the caller's membership (role and join time) from the database: a removed member gets nothing, and
// the roles passed in (room session or getOfficeAccess, both cached) are not trusted.
export interface ChatService {
  // chat:send. Checks (protocol/chat.ts order), stores the message and its mentions, and answers it. The caller
  // broadcasts 'chat:new' only when created is true. A guest's everyone token becomes text (withoutEveryone).
  // Mentions notify members other than the author with no block between the two (prefs.blockedBetween); tokens of
  // non-members stay in the body as typed and notify nobody.
  // The rate limit (CHAT_RATE_LIMIT, sliding window per company and user) lives in this service's memory: one server
  // process (P1b), and a restart forgets it.
  send(scope: ChatScope, author: ChatAuthor, request: ChatSendRequest): Promise<ChatSendResult>
  // GET /api/offices/:officeId/chat. A guest gets only the messages since their member.createdAt. Messages of
  // people the viewer blocked are included (the client hides them, as it does for live messages).
  list(scope: ChatScope, viewer: ChatUser, query: ChatHistoryQuery): Promise<ChatHistoryResponse>
  // chat:delete: the author, or an owner or admin (audit entry 'chat.delete' when it is not the author).
  delete(scope: ChatScope, actor: ChatUser, messageId: string): Promise<ChatDeleteResult>
  // chat:read. Only moves forward; an id that is not a message of the office is ignored (false). The room coalesces
  // calls.
  markRead(scope: ChatScope, userId: string, lastReadId: string): Promise<boolean>
  // GET /api/offices/:officeId/chat/unread.
  unread(scope: ChatScope, viewer: ChatUser): Promise<ChatUnreadResponse>
}

export function toChatMessage(record: ChatMessageRecord): ChatMessage {
  return {
    id: record.id,
    clientMsgId: record.clientMsgId,
    authorId: record.authorId,
    authorName: displayName(record.author),
    body: record.body,
    createdAt: record.createdAt.toISOString(),
    deletedAt: record.deletedAt?.toISOString() ?? null,
  }
}

export function createChatService(deps: { db: Db; prefs: PrefsService; moderation: Moderation; now?: () => number }): ChatService {
  const { db, prefs, moderation } = deps
  const now = deps.now ?? Date.now
  const sent = createSlidingWindow(CHAT_RATE_LIMIT.messages, CHAT_RATE_LIMIT.windowMs)

  const membership = async (tenant: ReturnType<typeof forOrg>, userId: string) => {
    const found = await tenant.findMember(userId)
    const role = found === null ? null : toOrgRole(found.role)
    return found === null || role === null ? null : { role, joinedAt: found.joinedAt }
  }
  // A guest's history and unread counts start when they joined the company.
  const sinceFor = (member: { role: OrgRole; joinedAt: Date }) => (member.role === 'guest' ? member.joinedAt : null)

  return {
    async send(scope, author, request) {
      const parsed = ChatSendRequestSchema.safeParse(request)
      if (!parsed.success) return { ok: false, reason: 'invalid' }
      const tenant = forOrg(db, scope.orgId)
      const member = await membership(tenant, author.userId)
      if (member === null) return { ok: false, reason: 'invalid' }
      const normalized = normalizeChatBody(parsed.data.body)
      const body = member.role === 'guest' ? withoutEveryone(normalized) : normalized
      if (body === '') return { ok: false, reason: 'empty' }
      if (body.length > CHAT_MAX_LENGTH) return { ok: false, reason: 'too_long' }

      const clientMsgId = parsed.data.clientMsgId.toLowerCase()
      const earlier = await tenant.findChatMessageByClientMsgId(scope.officeId, author.userId, clientMsgId)
      if (earlier !== null) return { ok: true, message: toChatMessage(earlier), created: false }
      const mutedUntil = await moderation.mutedUntil(scope.orgId, author.userId)
      if (mutedUntil !== null) return { ok: false, reason: 'muted', mutedUntil }

      const at = now()
      const release = sent.take(`${scope.orgId}/${author.userId}`, at)
      if (release === null) return { ok: false, reason: 'rate_limited' }
      try {
        const mentions = parseMentions(body)
        const others = mentions.userIds.filter((id) => id !== author.userId)
        const blocked = await prefs.blockedBetween(scope.orgId, author.userId, others)
        const stored = await tenant.insertChatMessage({
          officeId: scope.officeId,
          authorId: author.userId,
          clientMsgId,
          body,
          mentionsEveryone: mentions.everyone,
          mentionUserIds: others.filter((id) => !blocked.has(id)),
          createdAt: new Date(at),
        })
        // A retry that raced this one (created false) or a clientMsgId of another office (null) is not a new message.
        if (stored === null || !stored.created) release()
        if (stored === null) return { ok: false, reason: 'invalid' }
        return { ok: true, message: toChatMessage(stored.message), created: stored.created }
      } catch (error) {
        release()
        throw error
      }
    },

    async list(scope, viewer, query) {
      const tenant = forOrg(db, scope.orgId)
      const member = await membership(tenant, viewer.userId)
      if (member === null) return { messages: [], nextBefore: null }
      const limit = Math.min(Math.max(Math.trunc(query.limit), 1), CHAT_PAGE_SIZE)
      // One more than the page tells whether an older page exists.
      const rows = await tenant.listChatMessages(scope.officeId, { before: query.before, limit: limit + 1, since: sinceFor(member) })
      const page = rows.slice(0, limit)
      return { messages: page.map(toChatMessage), nextBefore: rows.length > limit ? (page.at(-1)?.id ?? null) : null }
    },

    async delete(scope, actor, messageId) {
      const id = MessageIdSchema.safeParse(messageId)
      if (!id.success) return { ok: false, reason: 'invalid' }
      const tenant = forOrg(db, scope.orgId)
      const member = await membership(tenant, actor.userId)
      if (member === null) return { ok: false, reason: 'not_allowed' }
      const message = await tenant.getChatMessage(scope.officeId, id.data)
      if (message === null || message.deletedAt !== null) return { ok: false, reason: 'not_found' }
      const own = message.authorId === actor.userId
      if (!own && !isModerator(member.role)) return { ok: false, reason: 'not_allowed' }
      if (!(await tenant.deleteChatMessage(scope.officeId, message.id, actor.userId, new Date(now())))) {
        return { ok: false, reason: 'not_found' }
      }
      if (!own) {
        await tenant.audit({
          actorId: actor.userId,
          action: 'chat.delete',
          targetType: 'chat_message',
          targetId: message.id,
          data: { officeId: scope.officeId, authorId: message.authorId },
        })
      }
      return { ok: true }
    },

    async markRead(scope, userId, lastReadId) {
      const id = MessageIdSchema.safeParse(lastReadId)
      if (!id.success) return false
      return forOrg(db, scope.orgId).markChatRead(scope.officeId, userId, id.data.toLowerCase(), new Date(now()))
    },

    async unread(scope, viewer) {
      const tenant = forOrg(db, scope.orgId)
      const member = await membership(tenant, viewer.userId)
      if (member === null) return { count: 0, mentions: 0, lastReadId: null }
      const { blockedUserIds } = await prefs.get(scope.orgId, viewer.userId)
      return tenant.countUnread(scope.officeId, viewer.userId, { since: sinceFor(member), blockedUserIds, limit: UNREAD_COUNT_LIMIT })
    },
  }
}
