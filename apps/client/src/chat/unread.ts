import { UNREAD_COUNT_LIMIT, type ChatMessage, type ChosenStatus } from '@vo/shared'
import { compareIds } from './messages.ts'

export interface ChatViewer {
  userId: string
  blocked: ReadonlySet<string>
}

export interface UnreadCounts {
  count: number
  mentions: number
}

export const NO_UNREAD: UnreadCounts = { count: 0, mentions: 0 }

// What GET /chat/unread counts: not own, not deleted, not from someone the viewer blocked. Mentions count by the
// server's mentionsYou, never by the tokens in the body.
export function countsAsUnread(message: ChatMessage, viewer: ChatViewer): boolean {
  return message.authorId !== viewer.userId && message.deletedAt === null && !viewer.blocked.has(message.authorId)
}

export function addUnread(counts: UnreadCounts, message: ChatMessage, viewer: ChatViewer): UnreadCounts {
  if (!countsAsUnread(message, viewer)) return counts
  return {
    count: Math.min(counts.count + 1, UNREAD_COUNT_LIMIT),
    mentions: Math.min(counts.mentions + (message.mentionsYou ? 1 : 0), UNREAD_COUNT_LIMIT),
  }
}

// A deleted message that was counted no longer is.
export function removeUnread(counts: UnreadCounts, message: ChatMessage, viewer: ChatViewer, lastReadId: string | null): UnreadCounts {
  if (!countsAsUnread(message, viewer) || (lastReadId !== null && compareIds(message.id, lastReadId) <= 0)) return counts
  return {
    count: Math.max(counts.count - 1, 0),
    mentions: Math.max(counts.mentions - (message.mentionsYou ? 1 : 0), 0),
  }
}

// The user sees the newest messages: the bar is open, its list is scrolled to the bottom and the tab is visible.
export function isReading(view: { expanded: boolean; atBottom: boolean; visible: boolean }): boolean {
  return view.expanded && view.atBottom && view.visible
}

// The id to send with chat:read: the newest loaded message, when it is newer than the read state.
export function readTarget(messages: readonly ChatMessage[], lastReadId: string | null): string | null {
  const newest = messages.at(-1)?.id
  if (newest === undefined) return null
  return lastReadId === null || compareIds(newest, lastReadId) > 0 ? newest : null
}

export interface NotifyInput {
  message: ChatMessage
  viewer: ChatViewer
  chosenStatus: ChosenStatus
  notifyMentions: boolean
  hidden: boolean
  permission: NotificationPermission | 'unsupported'
}

// A browser notification for a live message that mentions the viewer (or everyone; the server's mentionsYou, so
// never across a block), only while the tab is hidden and never on DND.
export function shouldNotify({ message, viewer, chosenStatus, notifyMentions, hidden, permission }: NotifyInput): boolean {
  return (
    hidden &&
    permission === 'granted' &&
    notifyMentions &&
    chosenStatus !== 'dnd' &&
    countsAsUnread(message, viewer) &&
    message.mentionsYou
  )
}

// The unread counts after the newest page: exact from the loaded messages when they reach back to the read state
// (e.g. a chat:read the server never got, while offline), else the server's.
export function unreadAfter(
  messages: readonly ChatMessage[],
  lastReadId: string | null,
  viewer: ChatViewer,
  complete: boolean,
): UnreadCounts | null {
  const oldest = messages[0]?.id
  if (lastReadId === null || oldest === undefined || (!complete && compareIds(oldest, lastReadId) > 0)) return null
  const unread = messages.filter((m) => compareIds(m.id, lastReadId) > 0 && countsAsUnread(m, viewer))
  return {
    count: Math.min(unread.length, UNREAD_COUNT_LIMIT),
    mentions: Math.min(unread.filter((m) => m.mentionsYou).length, UNREAD_COUNT_LIMIT),
  }
}
