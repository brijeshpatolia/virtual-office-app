import { z } from 'zod'

// The office chat (one global channel per office). Messages live in Postgres, never in the room state.

// The server accepts at most CHAT_RATE_LIMIT.messages per author in any CHAT_RATE_LIMIT.windowMs (a sliding window
// over accepted messages): the sixth message within 10 s is rejected with 'rate_limited'.
export const CHAT_RATE_LIMIT = { messages: 5, windowMs: 10_000 } as const
// Page size of GET /api/offices/:officeId/chat (and its maximum).
export const CHAT_PAGE_SIZE = 50
// The unread counts stop at this number; the client shows UNREAD_BADGE_MAX + '+' above UNREAD_BADGE_MAX.
export const UNREAD_COUNT_LIMIT = 100
export const UNREAD_BADGE_MAX = 99

export function unreadBadge(count: number): string {
  return count > UNREAD_BADGE_MAX ? `${UNREAD_BADGE_MAX}+` : String(count)
}

// Message ids are uuidv7 (RFC 9562), made by the server: they sort by time as text and as Postgres uuid, so
// "older than X" is "id < X" (keyset paging) and "unread" is "id > lastReadId".
export const MessageIdSchema = z.uuid()
const isoDate = z.iso.datetime()

export const ChatMessageSchema = z.object({
  id: MessageIdSchema,
  // The author's id for this message (idempotent retries); lets the author match its pending message.
  clientMsgId: z.uuid(),
  authorId: z.string(),
  authorName: z.string(),
  // The normalized body with its mention tokens (chatText.ts). '' when deleted.
  body: z.string(),
  createdAt: isoDate,
  // Not null: a tombstone. Show "Message deleted" in its place.
  deletedAt: isoDate.nullable(),
})
export type ChatMessage = z.infer<typeof ChatMessageSchema>

// Request 'chat:send'. clientMsgId: crypto.randomUUID() per message, reused on a retry. The server stores the
// message BEFORE it broadcasts it; a retry with the same clientMsgId answers the stored message and broadcasts
// nothing and does not count for the rate limit. Checks in this order: invalid, empty / too_long (after
// normalizeChatBody), duplicate (answer the stored message), muted, rate_limited.
export const ChatSendRequestSchema = z.object({ clientMsgId: z.uuid(), body: z.string() })
export type ChatSendRequest = z.infer<typeof ChatSendRequestSchema>
export const ChatSendResponseSchema = z.object({ ok: z.literal(true), message: ChatMessageSchema })
export type ChatSendResponse = z.infer<typeof ChatSendResponseSchema>
export const CHAT_SEND_REJECT_REASONS = ['rate_limited', 'too_long', 'empty', 'muted', 'invalid'] as const
export type ChatSendRejectReason = (typeof CHAT_SEND_REJECT_REASONS)[number]

// Server to client 'chat:new': a new message, to every client in the room except its author's.
// The client hides messages whose author is in its blocked list.

// Request 'chat:delete' (the author, or an owner or admin). Soft delete: the row stays as a tombstone without
// body. Success broadcasts 'chat:deleted' to every client.
export const ChatDeleteRequestSchema = z.object({ id: MessageIdSchema })
export type ChatDeleteRequest = z.infer<typeof ChatDeleteRequestSchema>
export const ChatDeleteResponseSchema = z.object({ ok: z.literal(true) })
export type ChatDeleteResponse = z.infer<typeof ChatDeleteResponseSchema>
export const CHAT_DELETE_REJECT_REASONS = ['not_found', 'not_allowed', 'invalid'] as const
export type ChatDeleteRejectReason = (typeof CHAT_DELETE_REJECT_REASONS)[number]
export const ChatDeletedSchema = z.object({ id: MessageIdSchema })
export type ChatDeleted = z.infer<typeof ChatDeletedSchema>

// Client to server, send 'chat:read': the newest message the user has seen. The read state only moves forward;
// an id that is not a message of this office is ignored.
export const ChatReadSchema = z.object({ lastReadId: MessageIdSchema })
export type ChatRead = z.infer<typeof ChatReadSchema>

// Server to client 'chat:muted', to the muted user only: muted until `until`, or unmuted (null).
export const ChatMutedSchema = z.object({ until: isoDate.nullable() })
export type ChatMuted = z.infer<typeof ChatMutedSchema>
