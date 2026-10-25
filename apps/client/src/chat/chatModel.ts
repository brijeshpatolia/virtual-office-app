import {
  CHAT_MAX_LENGTH,
  normalizeChatBody,
  rejectReason,
  type ChatHistoryResponse,
  type ChatMessage,
  type ChatMuted,
  type ChatUnreadResponse,
} from '@vo/shared'
import { errorMessage } from '../api/http.ts'
import { isRequestTimeout, type OfficeLink, type Unsubscribe } from '../net/officeLink.ts'
import type { OfficeApi } from '../office/officeApi.ts'
import { deleteRejectText, NO_ANSWER_TEXT, OFFLINE_TEXT, sendRejectText } from './format.ts'
import { compareIds, EMPTY_HISTORY, mergeMessages, withDeleted, withNewestPage, withOlderPage, type ChatHistory } from './messages.ts'
import { addUnread, NO_UNREAD, readTarget, removeUnread, unreadAfter, type ChatViewer, type UnreadCounts } from './unread.ts'

export interface PendingMessage {
  clientMsgId: string
  body: string
  createdAt: string
  status: 'sending' | 'failed'
  error: string | null
  // It failed for lack of a connection (or of an answer): sent again (same clientMsgId) once the connection is back.
  retryOnReconnect: boolean
}

export interface ChatSnapshot {
  history: ChatHistory
  pending: readonly PendingMessage[]
  loadingOlder: boolean
  loadError: string | null
  unread: UnreadCounts
  lastReadId: string | null
  // The last failed send or delete, for the bar.
  error: string | null
  mutedUntil: string | null
}

export interface ChatModelDeps {
  api: Pick<OfficeApi, 'chatHistory' | 'chatUnread'>
  selfId: string
  newClientMsgId?: () => string
  now?: () => number
  setTimer?: (run: () => void, ms: number) => () => void
}

// chat:read goes out at most once per this many ms (the last id wins).
export const READ_THROTTLE_MS = 1000
// A chat:send without an answer in time (the server may have stored it) goes out again with its clientMsgId this
// many times, after SEND_RETRY_MS and then twice that, before it shows as not confirmed.
export const SEND_RETRIES = 2
export const SEND_RETRY_MS = 1500
// How many chat:deleted ids of messages that are not loaded are kept: a page on its way then shows them deleted.
const DELETED_MEMORY = 200

const INITIAL: ChatSnapshot = {
  history: EMPTY_HISTORY,
  pending: [],
  loadingOlder: false,
  loadError: null,
  unread: NO_UNREAD,
  lastReadId: null,
  error: null,
  mutedUntil: null,
}

const later = (a: string | null, b: string | null): string | null => (a === null ? b : b === null ? a : compareIds(a, b) >= 0 ? a : b)

const browserTimer = (run: () => void, ms: number): (() => void) => {
  const timer = window.setTimeout(run, ms)
  return () => window.clearTimeout(timer)
}

// The office chat outside React (ChatBar reads it with useSyncExternalStore). It keeps the loaded history (oldest
// first, deduplicated), the messages on their way, the unread counts and the read state.
export class ChatModel {
  private readonly deps: Required<ChatModelDeps>
  private readonly listeners = new Set<() => void>()
  private readonly incoming = new Set<(message: ChatMessage) => void>()
  private snapshot: ChatSnapshot = INITIAL
  private link: OfficeLink | null = null
  private blocked: ReadonlySet<string> = new Set()
  private reading = false
  private unreadRequest = 0
  private queuedRead: string | null = null
  private readCooldown: (() => void) | null = null
  private muteTimer: (() => void) | null = null
  private muteVersion = 0
  // Set when the connection is lost: the newest message loaded until then. Messages that come in after it may sit
  // above a hole, so the next newest page is checked against this one.
  private staleAnchor: { id: string | null } | null = null
  // chat:deleted for messages that are not in the history (id -> deletedAt).
  private readonly deletedUnknown = new Map<string, string>()

  constructor(deps: ChatModelDeps) {
    this.deps = {
      newClientMsgId: () => crypto.randomUUID(),
      now: () => Date.now(),
      setTimer: browserTimer,
      ...deps,
    }
  }

  readonly getSnapshot = (): ChatSnapshot => this.snapshot

  readonly subscribe = (listener: () => void): Unsubscribe => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // Live messages from other people that the viewer has not blocked (for notifications).
  onIncoming(handler: (message: ChatMessage) => void): Unsubscribe {
    this.incoming.add(handler)
    return () => this.incoming.delete(handler)
  }

  // A joined room: listen to it, load the newest page and the unread counts, send what failed offline.
  attach(link: OfficeLink): Unsubscribe {
    this.link = link
    const subscriptions = [
      link.onChatNew((message) => this.receive(message)),
      link.onChatDeleted(({ id }) => this.applyDeleted(id)),
      link.onChatMuted((muted) => this.applyMuted(muted)),
    ]
    void this.refresh()
    this.retryOffline()
    return () => {
      for (const unsubscribe of subscriptions) unsubscribe()
      if (this.link === link) {
        this.link = null
        this.dropped()
      }
    }
  }

  // The connection dropped (the SDK tries to reconnect): nothing that is sent meanwhile reaches this client.
  dropped(): void {
    const { history } = this.snapshot
    this.staleAnchor ??= { id: history.loaded ? (history.messages.at(-1)?.id ?? null) : null }
  }

  // The SDK reconnected the same session: messages sent meanwhile are not replayed, so load the newest page again.
  reconnected(): void {
    void this.refresh()
    this.retryOffline()
  }

  // Stops the timers. The model stays usable (React StrictMode runs effect cleanups and then the effects again).
  destroy(): void {
    this.readCooldown?.()
    this.readCooldown = null
    this.muteTimer?.()
    this.muteTimer = null
    this.link = null
  }

  setError(error: string | null): void {
    if (this.snapshot.error !== error) this.update((s) => ({ ...s, error }))
  }

  setBlocked(blocked: ReadonlySet<string>): void {
    this.blocked = blocked
  }

  // The user sees the newest message (isReading): everything loaded counts as read.
  setReading(reading: boolean): void {
    this.reading = reading
    this.markReadIfReading()
  }

  // The newest page, the unread counts and the own mute, from the server.
  async refresh(): Promise<void> {
    const request = ++this.unreadRequest
    const muteVersion = this.muteVersion
    const stale = this.staleAnchor
    const anchor = stale ? stale.id : (this.snapshot.history.messages.at(-1)?.id ?? null)
    try {
      const [page, unread] = await Promise.all([this.deps.api.chatHistory(), this.deps.api.chatUnread()])
      if (this.staleAnchor === stale) this.staleAnchor = null
      this.update((s) => {
        const history = withNewestPage(s.history, this.withTombstones(page), anchor)
        return {
          ...s,
          history,
          pending: this.withoutStored(s.pending, history.messages),
          loadError: null,
          unread: request === this.unreadRequest ? this.unreadFrom(unread, history, s.lastReadId) : s.unread,
          lastReadId: later(s.lastReadId, unread.lastReadId),
        }
      })
      // A mute or an unmute that happened while this client was not connected.
      if (muteVersion === this.muteVersion && unread.mutedUntil !== this.snapshot.mutedUntil) this.applyMuted({ until: unread.mutedUntil })
      // A chat:read that was dropped while offline.
      const local = this.snapshot.lastReadId
      if (local !== null && later(local, unread.lastReadId) !== unread.lastReadId) this.queueRead(local)
      this.markReadIfReading()
    } catch (error) {
      this.update((s) => ({ ...s, loadError: errorMessage(error) }))
    }
  }

  async loadOlder(): Promise<void> {
    const { history, loadingOlder } = this.snapshot
    const before = history.nextBefore
    if (loadingOlder || !history.loaded || before === null) return
    this.update((s) => ({ ...s, loadingOlder: true }))
    try {
      const page = this.withTombstones(await this.deps.api.chatHistory(before))
      // A newer page may have replaced the list meanwhile (after a gap); then this page no longer fits.
      this.update((s) => (s.history.nextBefore === before ? { ...s, history: withOlderPage(s.history, page), loadError: null } : s))
    } catch (error) {
      this.update((s) => ({ ...s, loadError: errorMessage(error) }))
    } finally {
      this.update((s) => ({ ...s, loadingOlder: false }))
    }
  }

  // body: the text with its mention tokens. false: nothing to send, or too long (error set).
  send(raw: string): boolean {
    const body = normalizeChatBody(raw)
    if (body === '') return false
    if (body.length > CHAT_MAX_LENGTH) {
      this.update((s) => ({ ...s, error: sendRejectText('too_long', s.mutedUntil) }))
      return false
    }
    const pending: PendingMessage = {
      clientMsgId: this.deps.newClientMsgId(),
      body,
      createdAt: new Date(this.deps.now()).toISOString(),
      status: 'sending',
      error: null,
      retryOnReconnect: false,
    }
    this.update((s) => ({ ...s, pending: [...s.pending, pending], error: null }))
    this.deliver(pending.clientMsgId)
    return true
  }

  retry(clientMsgId: string): void {
    this.setError(null)
    this.patchPending(clientMsgId, { status: 'sending', error: null, retryOnReconnect: false })
    this.deliver(clientMsgId)
  }

  discard(clientMsgId: string): void {
    this.update((s) => ({ ...s, pending: s.pending.filter((p) => p.clientMsgId !== clientMsgId) }))
  }

  async delete(id: string): Promise<boolean> {
    const link = this.link
    if (!link) {
      this.update((s) => ({ ...s, error: deleteRejectText(null) }))
      return false
    }
    try {
      await link.deleteChat(id)
      this.applyDeleted(id)
      return true
    } catch (error) {
      this.update((s) => ({ ...s, error: deleteRejectText(rejectReason(error)) }))
      return false
    }
  }

  private get viewer(): ChatViewer {
    return { userId: this.deps.selfId, blocked: this.blocked }
  }

  private deliver(clientMsgId: string, attempt = 0): void {
    const pending = this.snapshot.pending.find((p) => p.clientMsgId === clientMsgId)
    if (!pending) return
    const link = this.link
    if (!link) {
      this.patchPending(clientMsgId, { status: 'failed', error: OFFLINE_TEXT, retryOnReconnect: true })
      return
    }
    link.sendChat({ clientMsgId, body: pending.body }).then(
      (message) => this.store(message),
      (error: unknown) => {
        const reason = rejectReason(error)
        // No answer on an open connection: it may be stored, and a retry with the same clientMsgId is safe.
        if (reason === null && isRequestTimeout(error) && attempt < SEND_RETRIES) {
          this.deps.setTimer(() => this.deliver(clientMsgId, attempt + 1), SEND_RETRY_MS * 2 ** attempt)
          return
        }
        if (reason === null) {
          const text = isRequestTimeout(error) ? NO_ANSWER_TEXT : OFFLINE_TEXT
          this.patchPending(clientMsgId, { status: 'failed', error: text, retryOnReconnect: true })
          return
        }
        const text = sendRejectText(reason, this.snapshot.mutedUntil)
        this.patchPending(clientMsgId, { status: 'failed', error: text, retryOnReconnect: false })
        this.update((s) => ({ ...s, error: text }))
      },
    )
  }

  private retryOffline(): void {
    for (const pending of this.snapshot.pending) if (pending.retryOnReconnect) this.retry(pending.clientMsgId)
  }

  // The answer to our own chat:send.
  private store(answer: ChatMessage): void {
    const message = this.tombstoned(answer)
    this.update((s) => {
      const messages = mergeMessages(s.history.messages, [message])
      return { ...s, history: { ...s.history, messages }, pending: this.withoutStored(s.pending, messages) }
    })
    this.markReadIfReading()
  }

  private receive(incoming: ChatMessage): void {
    const message = this.tombstoned(incoming)
    const known = this.snapshot.history.messages.some((m) => m.id === message.id)
    this.update((s) => {
      const messages = mergeMessages(s.history.messages, [message])
      const read = s.lastReadId !== null && compareIds(message.id, s.lastReadId) <= 0
      return {
        ...s,
        history: { ...s.history, messages },
        pending: this.withoutStored(s.pending, messages),
        unread: known || read || this.reading ? s.unread : addUnread(s.unread, message, this.viewer),
      }
    })
    if (!known && message.deletedAt === null && message.authorId !== this.deps.selfId && !this.blocked.has(message.authorId)) {
      for (const handler of [...this.incoming]) handler(message)
    }
    this.markReadIfReading()
  }

  private applyDeleted(id: string): void {
    const message = this.snapshot.history.messages.find((m) => m.id === id)
    const at = new Date(this.deps.now()).toISOString()
    if (!message) {
      // Not loaded (yet): a page on its way must not bring the text back, and the counts may include it.
      this.deletedUnknown.delete(id)
      this.deletedUnknown.set(id, at)
      if (this.deletedUnknown.size > DELETED_MEMORY) this.deletedUnknown.delete(this.deletedUnknown.keys().next().value ?? '')
      const read = this.snapshot.lastReadId
      if (read === null || compareIds(id, read) > 0) void this.refreshUnread()
      return
    }
    this.update((s) => ({
      ...s,
      history: { ...s.history, messages: withDeleted(s.history.messages, id, at) },
      unread: message && message.deletedAt === null ? removeUnread(s.unread, message, this.viewer, s.lastReadId) : s.unread,
    }))
  }

  private applyMuted({ until }: ChatMuted): void {
    this.muteVersion += 1
    this.muteTimer?.()
    this.muteTimer = null
    this.setMutedUntil(until)
    if (until === null) return
    const ms = Date.parse(until) - this.deps.now()
    this.muteTimer = this.deps.setTimer(() => {
      if (this.snapshot.mutedUntil === until) this.setMutedUntil(null)
    }, Math.max(ms, 0))
  }

  // A refusal shown for the previous mute is stale once the mute changes or ends.
  private setMutedUntil(until: string | null): void {
    this.update((s) => ({ ...s, mutedUntil: until, error: s.error === sendRejectText('muted', s.mutedUntil) ? null : s.error }))
  }

  private markReadIfReading(): void {
    if (!this.reading) return
    const s = this.snapshot
    const target = readTarget(s.history.messages, s.lastReadId)
    if (target === null && s.unread.count === 0 && s.unread.mentions === 0) return
    this.update((state) => ({ ...state, unread: NO_UNREAD, lastReadId: target ?? state.lastReadId }))
    if (target !== null) this.queueRead(target)
  }

  private queueRead(id: string): void {
    this.queuedRead = id
    if (this.readCooldown === null) this.flushRead()
  }

  // A read the link could not send (offline) stays queued; the next refresh sends it.
  private flushRead(): void {
    const id = this.queuedRead
    const link = this.link
    if (id === null || link === null || !link.markChatRead(id)) return
    this.queuedRead = null
    this.readCooldown = this.deps.setTimer(() => {
      this.readCooldown = null
      this.flushRead()
    }, READ_THROTTLE_MS)
  }

  // Only the counts (after a delete of a message that is not loaded).
  private async refreshUnread(): Promise<void> {
    const request = ++this.unreadRequest
    try {
      const unread = await this.deps.api.chatUnread()
      if (request !== this.unreadRequest) return
      this.update((s) => ({ ...s, unread: this.unreadFrom(unread, s.history, s.lastReadId), lastReadId: later(s.lastReadId, unread.lastReadId) }))
      this.markReadIfReading()
    } catch {
      // The counts stay as they are until the next refresh.
    }
  }

  // The server's counts, unless it has not heard of the newest read yet (a chat:read dropped while offline, or one
  // that waits for the server's write interval): then from the loaded messages, when they reach back to it.
  private unreadFrom(unread: ChatUnreadResponse, history: ChatHistory, localRead: string | null): UnreadCounts {
    const server = { count: unread.count, mentions: unread.mentions }
    const ahead = localRead !== null && (unread.lastReadId === null || compareIds(localRead, unread.lastReadId) > 0)
    return (ahead && unreadAfter(history.messages, localRead, this.viewer, history.nextBefore === null)) || server
  }

  private tombstoned(message: ChatMessage): ChatMessage {
    const at = this.deletedUnknown.get(message.id)
    return at === undefined || message.deletedAt !== null ? message : { ...message, body: '', deletedAt: at, mentionsYou: false }
  }

  private withTombstones(page: ChatHistoryResponse): ChatHistoryResponse {
    return this.deletedUnknown.size === 0 ? page : { ...page, messages: page.messages.map((m) => this.tombstoned(m)) }
  }

  private withoutStored(pending: readonly PendingMessage[], messages: readonly ChatMessage[]): readonly PendingMessage[] {
    if (pending.length === 0) return pending
    const stored = new Set(messages.filter((m) => m.authorId === this.deps.selfId).map((m) => m.clientMsgId))
    const left = pending.filter((p) => !stored.has(p.clientMsgId))
    return left.length === pending.length ? pending : left
  }

  private patchPending(clientMsgId: string, patch: Partial<PendingMessage>): void {
    this.update((s) => ({ ...s, pending: s.pending.map((p) => (p.clientMsgId === clientMsgId ? { ...p, ...patch } : p)) }))
  }

  private update(change: (snapshot: ChatSnapshot) => ChatSnapshot): void {
    const next = change(this.snapshot)
    if (next === this.snapshot) return
    this.snapshot = next
    for (const listener of [...this.listeners]) listener()
  }
}
