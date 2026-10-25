import {
  CHAT_MAX_LENGTH,
  CHAT_PAGE_SIZE,
  CHAT_RATE_LIMIT,
  EVERYONE_TOKEN,
  mentionToken,
  normalizeChatBody,
  parseMentions,
  UNREAD_COUNT_LIMIT,
  withoutEveryone,
  type ChatHistoryResponse,
  type ChatMessage,
  type ChatUnreadResponse,
  type MemberSummary,
  type OrgRole,
  type UpdatePrefsRequest,
  type UserPrefs,
} from '@vo/shared'
import { compareIds } from '../chat/messages.ts'
import type { OfficeApi } from '../office/officeApi.ts'
import { canModerate } from '../presence/people.ts'

// DEV ONLY: the "server side" of the mock office that outlives one room connection: messages, read state, prefs,
// mutes and members. mockOffice.ts is the room; this module also answers the HTTP calls (OfficeApi).

export const MOCK_OWN = { userId: 'mock-user-own', name: 'You (mock)' } as const

const BOTS: ReadonlyArray<{ userId: string; name: string; role: OrgRole }> = [
  { userId: 'mock-user-ada', name: 'Ada', role: 'admin' },
  { userId: 'mock-user-linus', name: 'Linus', role: 'member' },
  { userId: 'mock-user-grace', name: 'Grace', role: 'guest' },
  { userId: 'mock-user-margaret', name: 'Margaret', role: 'member' },
  { userId: 'mock-user-ken', name: 'Ken', role: 'member' },
]

const LINES = [
  'Morning all!',
  'Standup in 5 minutes, meeting room.',
  'The deploy went out, see https://example.com/releases/42.',
  'Who has the key to the storage room?',
  'Lunch at the place around the corner?',
  'PR is up for review, small one.',
  'Heads down until 3, ping me if it burns.',
  'Docs: https://developer.mozilla.org/en-US/docs/Web/API/Notification (the permission part).',
  'Coffee machine is fixed.',
  'Can someone check the staging server?',
  'Thanks!',
  'I will be in the meeting room for the next hour.',
]

// uuidv7: 48-bit ms, version 7, a 12-bit counter, variant 10, random bits. Sorts by time as text.
let lastMs = 0
let counter = 0
export function mockMessageId(ms: number): string {
  if (ms <= lastMs) {
    counter += 1
    if (counter > 0xfff) {
      lastMs += 1
      counter = 0
    }
  } else {
    lastMs = ms
    counter = 0
  }
  const hex = (n: number, width: number): string => n.toString(16).padStart(width, '0')
  const random = (width: number): string => Array.from({ length: width }, () => hex(Math.floor(Math.random() * 16), 1)).join('')
  const time = hex(lastMs, 12)
  const variant = hex(8 + Math.floor(Math.random() * 4), 1)
  return `${time.slice(0, 8)}-${time.slice(8)}-7${hex(counter, 3)}-${variant}${random(3)}-${random(12)}`
}

interface StoredMessage extends Omit<ChatMessage, 'mentionsYou'> {
  mentions: string[]
  everyone: boolean
}

export type MockSendResult = { ok: true; message: ChatMessage; created: boolean } | { ok: false; reason: string }

export class MockChatServer {
  readonly role: OrgRole
  // The own membership: guests see messages from here on.
  readonly joinedAt: number
  private readonly messages: StoredMessage[] = []
  private readonly sent: number[] = []
  private readonly mutes = new Map<string, number>()
  private lastReadId: string | null = null
  private prefs: UserPrefs = { statusText: '', blockedUserIds: [], notifyMentions: true }

  constructor(role: OrgRole) {
    this.role = role
    const now = Date.now()
    this.joinedAt = role === 'guest' ? now - 40 * 60_000 : now - 30 * 86_400_000
    // 130 messages over the last 3 hours: three pages and a bit.
    for (let i = 0; i < 130; i++) {
      const at = now - (130 - i) * 83_000
      const bot = BOTS[i % 4] ?? BOTS[0]
      if (!bot) continue
      const line = LINES[i % LINES.length] ?? ''
      const body = i % 17 === 5 ? `${mentionToken(MOCK_OWN.userId)} ${line}` : i % 29 === 7 ? `${EVERYONE_TOKEN} ${line}` : `#${i + 1} ${line}`
      this.insert(bot.userId, bot.name, body, crypto.randomUUID(), at)
    }
    this.lastReadId = this.messages.at(-8)?.id ?? null
  }

  get members(): MemberSummary[] {
    const joinedAt = new Date(this.joinedAt).toISOString()
    return [{ userId: MOCK_OWN.userId, name: MOCK_OWN.name, role: this.role, joinedAt }, ...BOTS.map((b) => ({ ...b, joinedAt }))]
  }

  roleOf(userId: string): OrgRole | null {
    return this.members.find((m) => m.userId === userId)?.role ?? null
  }

  get blocked(): readonly string[] {
    return this.prefs.blockedUserIds
  }

  get statusText(): string {
    return this.prefs.statusText
  }

  send(authorId: string, authorName: string, clientMsgId: string, raw: string, now: number): MockSendResult {
    const body = normalizeChatBody(raw)
    if (body === '') return { ok: false, reason: 'empty' }
    if (body.length > CHAT_MAX_LENGTH) return { ok: false, reason: 'too_long' }
    const stored = this.messages.find((m) => m.authorId === authorId && m.clientMsgId === clientMsgId)
    if (stored) return { ok: true, message: this.view(stored), created: false }
    if ((this.mutes.get(authorId) ?? 0) > now) return { ok: false, reason: 'muted' }
    if (authorId === MOCK_OWN.userId) {
      while (this.sent.length > 0 && (this.sent[0] ?? 0) <= now - CHAT_RATE_LIMIT.windowMs) this.sent.shift()
      if (this.sent.length >= CHAT_RATE_LIMIT.messages) return { ok: false, reason: 'rate_limited' }
      this.sent.push(now)
    }
    const guest = this.roleOf(authorId) === 'guest'
    return { ok: true, message: this.view(this.insert(authorId, authorName, guest ? withoutEveryone(body) : body, clientMsgId, now)), created: true }
  }

  delete(actorId: string, id: string, now: number): 'ok' | 'not_found' | 'not_allowed' {
    const message = this.messages.find((m) => m.id === id)
    if (!message || message.deletedAt !== null) return 'not_found'
    const role = this.roleOf(actorId)
    if (message.authorId !== actorId && role !== 'owner' && role !== 'admin') return 'not_allowed'
    Object.assign(message, { body: '', deletedAt: new Date(now).toISOString(), mentions: [], everyone: false })
    return 'ok'
  }

  markRead(id: string): void {
    if (!this.messages.some((m) => m.id === id)) return
    if (this.lastReadId === null || compareIds(id, this.lastReadId) > 0) this.lastReadId = id
  }

  moderates(actorId: string, targetId: string): boolean {
    const actor = this.roleOf(actorId)
    const target = this.roleOf(targetId)
    return actor !== null && target !== null && canModerate({ userId: actorId, role: actor }, { userId: targetId, role: target })
  }

  mute(actorId: string, targetId: string, minutes: number, now: number): { ok: true; until: string | null } | { ok: false; reason: string } {
    if (!this.roleOf(targetId)) return { ok: false, reason: 'not_found' }
    if (!this.moderates(actorId, targetId)) return { ok: false, reason: 'not_allowed' }
    if (minutes === 0) {
      this.mutes.delete(targetId)
      return { ok: true, until: null }
    }
    const until = now + minutes * 60_000
    this.mutes.set(targetId, until)
    return { ok: true, until: new Date(until).toISOString() }
  }

  // The own user, muted by a dev hook (window.__voMock.muteMe).
  muteOwn(minutes: number, now: number): string | null {
    if (minutes <= 0) {
      this.mutes.delete(MOCK_OWN.userId)
      return null
    }
    this.mutes.set(MOCK_OWN.userId, now + minutes * 60_000)
    return new Date(now + minutes * 60_000).toISOString()
  }

  setBlocked(targetId: string, blocked: boolean): { ok: true; blockedUserIds: string[] } | { ok: false; reason: string } {
    if (targetId === MOCK_OWN.userId) return { ok: false, reason: 'invalid' }
    if (blocked && !this.roleOf(targetId)) return { ok: false, reason: 'not_found' }
    const set = new Set(this.prefs.blockedUserIds)
    if (blocked) set.add(targetId)
    else set.delete(targetId)
    this.prefs = { ...this.prefs, blockedUserIds: [...set] }
    return { ok: true, blockedUserIds: [...set] }
  }

  setStatusText(statusText: string): void {
    this.prefs = { ...this.prefs, statusText }
  }

  api(): OfficeApi {
    return {
      chatHistory: async (before) => this.history(before),
      chatUnread: async () => this.unread(),
      members: async () => {
        if (this.role === 'guest') throw new Error('Guests cannot list the members')
        return this.members
      },
      prefs: async () => this.prefs,
      updatePrefs: async (patch: UpdatePrefsRequest) => {
        this.prefs = { ...this.prefs, ...patch }
        return this.prefs
      },
    }
  }

  private visible(m: StoredMessage): boolean {
    return this.role !== 'guest' || Date.parse(m.createdAt) >= this.joinedAt
  }

  private history(before: string | undefined): ChatHistoryResponse {
    const older = this.messages.filter((m) => this.visible(m) && (before === undefined || compareIds(m.id, before) < 0))
    const page = older.slice(-CHAT_PAGE_SIZE).reverse()
    const more = older.length > CHAT_PAGE_SIZE
    return { messages: page.map((m) => this.view(m)), nextBefore: more ? (page.at(-1)?.id ?? null) : null }
  }

  private unread(): ChatUnreadResponse {
    const blocked = new Set(this.prefs.blockedUserIds)
    const after = this.messages.filter(
      (m) =>
        this.visible(m) &&
        m.authorId !== MOCK_OWN.userId &&
        m.deletedAt === null &&
        !blocked.has(m.authorId) &&
        (this.lastReadId === null || compareIds(m.id, this.lastReadId) > 0),
    )
    const mentions = after.filter((m) => this.mentionsOwn(m)).length
    const muted = this.mutes.get(MOCK_OWN.userId) ?? 0
    return {
      count: Math.min(after.length, UNREAD_COUNT_LIMIT),
      mentions: Math.min(mentions, UNREAD_COUNT_LIMIT),
      lastReadId: this.lastReadId,
      mutedUntil: muted > Date.now() ? new Date(muted).toISOString() : null,
    }
  }

  private insert(authorId: string, authorName: string, body: string, clientMsgId: string, at: number): StoredMessage {
    const { userIds, everyone } = parseMentions(body)
    const message: StoredMessage = {
      id: mockMessageId(at),
      clientMsgId,
      authorId,
      authorName,
      body,
      createdAt: new Date(at).toISOString(),
      deletedAt: null,
      mentions: userIds.filter((id) => id !== authorId),
      everyone,
    }
    this.messages.push(message)
    return message
  }

  // As the server decides mentionsYou: by id or everyone, not own or deleted, and no block (the bots block nobody).
  private mentionsOwn(m: StoredMessage): boolean {
    const mentioned = m.everyone || m.mentions.includes(MOCK_OWN.userId)
    return mentioned && m.authorId !== MOCK_OWN.userId && m.deletedAt === null && !this.prefs.blockedUserIds.includes(m.authorId)
  }

  private view(m: StoredMessage): ChatMessage {
    const { id, clientMsgId, authorId, authorName, body, createdAt, deletedAt } = m
    return { id, clientMsgId, authorId, authorName, body, createdAt, deletedAt, mentionsYou: this.mentionsOwn(m) }
  }
}

let server: MockChatServer | null = null

// One mock server per page load; the first caller picks the own role.
export function mockChatServer(role: OrgRole): MockChatServer {
  server ??= new MockChatServer(role)
  return server
}

export const MOCK_LINES = LINES
