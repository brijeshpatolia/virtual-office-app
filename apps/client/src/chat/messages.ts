import type { ChatHistoryResponse, ChatMessage } from '@vo/shared'

// Message ids are uuidv7: as lowercase text they sort by time.
export function compareIds(a: string, b: string): number {
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  return x < y ? -1 : x > y ? 1 : 0
}

// Oldest first, one entry per id. A tombstone wins over a live copy of the same message.
export function mergeMessages(existing: readonly ChatMessage[], incoming: readonly ChatMessage[]): ChatMessage[] {
  if (incoming.length === 0) return [...existing]
  const last = existing.at(-1)
  const [only] = incoming
  if (incoming.length === 1 && only && (!last || compareIds(only.id, last.id) > 0)) return [...existing, only]
  const byId = new Map<string, ChatMessage>()
  for (const message of existing) byId.set(message.id, message)
  for (const message of incoming) {
    const old = byId.get(message.id)
    byId.set(message.id, old && old.deletedAt !== null && message.deletedAt === null ? old : message)
  }
  return [...byId.values()].sort((a, b) => compareIds(a.id, b.id))
}

export interface ChatHistory {
  messages: readonly ChatMessage[]
  // Cursor for the next older page; null when the oldest message is loaded.
  nextBefore: string | null
  // The newest page has been loaded at least once.
  loaded: boolean
}

export const EMPTY_HISTORY: ChatHistory = { messages: [], nextBefore: null, loaded: false }

// The newest page, at load and after a reconnect. When it does not reach back to the newest loaded message (more
// than a page was missed), the older messages are dropped, so the list never has a gap.
export function withNewestPage(history: ChatHistory, page: ChatHistoryResponse): ChatHistory {
  const newestLoaded = history.messages.at(-1)?.id
  const oldestOfPage = page.messages.at(-1)?.id
  const gap =
    history.loaded &&
    newestLoaded !== undefined &&
    oldestOfPage !== undefined &&
    page.nextBefore !== null &&
    compareIds(oldestOfPage, newestLoaded) > 0
  if (!history.loaded || gap) {
    return { messages: mergeMessages(gap ? [] : history.messages, page.messages), nextBefore: page.nextBefore, loaded: true }
  }
  return { ...history, messages: mergeMessages(history.messages, page.messages) }
}

export function withOlderPage(history: ChatHistory, page: ChatHistoryResponse): ChatHistory {
  return { ...history, messages: mergeMessages(history.messages, page.messages), nextBefore: page.nextBefore }
}

export function withDeleted(messages: readonly ChatMessage[], id: string, at: string): readonly ChatMessage[] {
  const index = messages.findIndex((m) => m.id === id)
  const message = messages[index]
  if (!message || message.deletedAt !== null) return messages
  const next = [...messages]
  next[index] = { ...message, body: '', deletedAt: at }
  return next
}

export type ChatRow =
  | { kind: 'message'; message: ChatMessage }
  // Consecutive messages from people the viewer blocked, shown as one line.
  | { kind: 'blocked'; key: string; count: number; people: number }

export function chatRows(messages: readonly ChatMessage[], blocked: ReadonlySet<string>): ChatRow[] {
  const rows: ChatRow[] = []
  let run: { first: string; count: number; authors: Set<string> } | null = null
  const flush = (): void => {
    if (run) rows.push({ kind: 'blocked', key: `blocked-${run.first}`, count: run.count, people: run.authors.size })
    run = null
  }
  for (const message of messages) {
    if (blocked.has(message.authorId)) {
      run ??= { first: message.id, count: 0, authors: new Set() }
      run.count += 1
      run.authors.add(message.authorId)
      continue
    }
    flush()
    rows.push({ kind: 'message', message })
  }
  flush()
  return rows
}

export function blockedRowText(count: number, people: number): string {
  if (count === 1) return '1 message from a blocked person'
  return `${count} messages from ${people === 1 ? 'a blocked person' : 'blocked people'}`
}
