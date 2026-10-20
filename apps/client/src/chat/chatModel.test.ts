import { describe, expect, it } from 'vitest'
import { mentionToken, type ChatHistoryResponse, type ChatMessage, type ChatSendRequest, type ChatUnreadResponse } from '@vo/shared'
import type { OfficeLink } from '../net/officeLink.ts'
import { ChatModel, READ_THROTTLE_MS } from './chatModel.ts'
import { idOf, message, numberOf } from './testMessages.ts'

const rejected = (reason: string): Error => Object.assign(new Error('request rejected'), { name: 'rejected', reason })
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

// The chat part of an OfficeLink, driven by the test.
function fakeLink() {
  const handlers = {
    new: [] as Array<(m: ChatMessage) => void>,
    deleted: [] as Array<(d: { id: string }) => void>,
    muted: [] as Array<(m: { until: string | null }) => void>,
  }
  const sends: ChatSendRequest[] = []
  const reads: string[] = []
  let answer: (request: ChatSendRequest) => Promise<ChatMessage> = async (request) => message(900, { authorId: 'me', clientMsgId: request.clientMsgId, body: request.body })
  const link = {
    sendChat: (request: ChatSendRequest) => {
      sends.push(request)
      return answer(request)
    },
    deleteChat: async () => undefined,
    markChatRead: (id: string) => reads.push(id),
    onChatNew: (h: (m: ChatMessage) => void) => (handlers.new.push(h), () => undefined),
    onChatDeleted: (h: (d: { id: string }) => void) => (handlers.deleted.push(h), () => undefined),
    onChatMuted: (h: (m: { until: string | null }) => void) => (handlers.muted.push(h), () => undefined),
  } as unknown as OfficeLink
  return {
    link,
    sends,
    reads,
    answerWith: (next: typeof answer) => (answer = next),
    push: (m: ChatMessage) => handlers.new.forEach((h) => h(m)),
    deleted: (id: string) => handlers.deleted.forEach((h) => h({ id })),
    muted: (until: string | null) => handlers.muted.forEach((h) => h({ until })),
  }
}

function setup(pages: ChatHistoryResponse[] = [{ messages: [], nextBefore: null }], unread: ChatUnreadResponse = { count: 0, mentions: 0, lastReadId: null }) {
  const timers: Array<{ run: () => void; at: number; live: boolean }> = []
  let now = 1_000
  const requests: Array<string | undefined> = []
  let ids = 0
  const model = new ChatModel({
    api: {
      chatHistory: async (before) => {
        requests.push(before)
        return pages.shift() ?? { messages: [], nextBefore: null }
      },
      chatUnread: async () => unread,
    },
    selfId: 'me',
    newClientMsgId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
    now: () => now,
    setTimer: (run, ms) => {
      const timer = { run, at: now + ms, live: true }
      timers.push(timer)
      return () => (timer.live = false)
    },
  })
  const advance = (ms: number): void => {
    now += ms
    for (const timer of timers.filter((t) => t.live && t.at <= now)) {
      timer.live = false
      timer.run()
    }
  }
  return { model, requests, advance }
}

describe('ChatModel sending', () => {
  it('shows a pending message and replaces it with the stored one', async () => {
    const { model } = setup()
    const fake = fakeLink()
    model.attach(fake.link)
    await flush()
    expect(model.send('  hello\r\n')).toBe(true)
    expect(model.getSnapshot().pending).toMatchObject([{ body: 'hello', status: 'sending' }])
    await flush()
    expect(model.getSnapshot().pending).toEqual([])
    expect(model.getSnapshot().history.messages.map((m) => m.body)).toEqual(['hello'])
    expect(model.send('   ')).toBe(false)
    expect(model.send('x'.repeat(2001))).toBe(false)
    expect(model.getSnapshot().error).toMatch(/Too long/)
  })

  it('keeps a rejected message with the reason, and a retry reuses its clientMsgId', async () => {
    const { model } = setup()
    const fake = fakeLink()
    model.attach(fake.link)
    fake.answerWith(async () => {
      throw rejected('rate_limited')
    })
    model.send('sixth')
    await flush()
    const [failed] = model.getSnapshot().pending
    expect(failed).toMatchObject({ status: 'failed', retryOnReconnect: false })
    expect(model.getSnapshot().error).toBe('Slow down: at most 5 messages in 10 seconds.')
    fake.answerWith(async (request) => message(901, { authorId: 'me', clientMsgId: request.clientMsgId, body: request.body }))
    model.retry(failed?.clientMsgId ?? '')
    await flush()
    expect(fake.sends.map((s) => s.clientMsgId)).toEqual([failed?.clientMsgId, failed?.clientMsgId])
    expect(model.getSnapshot().pending).toEqual([])
  })

  it('drops the muted refusal when the mute is lifted or runs out, and a retry clears the error', async () => {
    const { model, advance } = setup()
    const fake = fakeLink()
    model.attach(fake.link)
    const until = new Date(1_000 + 60_000).toISOString()
    fake.answerWith(async () => {
      fake.muted(until)
      throw rejected('muted')
    })
    model.send('hello?')
    await flush()
    expect(model.getSnapshot()).toMatchObject({ mutedUntil: until, error: expect.stringMatching(/^You are muted until /) })
    fake.muted(null)
    expect(model.getSnapshot()).toMatchObject({ mutedUntil: null, error: null })

    fake.muted(until)
    model.setError('Slow down: at most 5 messages in 10 seconds.')
    advance(60_000)
    expect(model.getSnapshot()).toMatchObject({ mutedUntil: null, error: 'Slow down: at most 5 messages in 10 seconds.' })
    fake.answerWith(async (request) => message(903, { authorId: 'me', clientMsgId: request.clientMsgId, body: request.body }))
    model.retry(model.getSnapshot().pending[0]?.clientMsgId ?? '')
    expect(model.getSnapshot().error).toBeNull()
    await flush()
    expect(model.getSnapshot().pending).toEqual([])
  })

  it('sends again after a reconnect what failed for lack of a connection', async () => {
    const { model } = setup()
    const fake = fakeLink()
    model.attach(fake.link)
    fake.answerWith(async () => {
      throw new Error('request "chat:send" timed out after 8000ms.')
    })
    model.send('are you there?')
    await flush()
    expect(model.getSnapshot().pending[0]).toMatchObject({ status: 'failed', retryOnReconnect: true })
    fake.answerWith(async (request) => message(902, { authorId: 'me', clientMsgId: request.clientMsgId, body: request.body }))
    model.reconnected()
    await flush()
    expect(new Set(fake.sends.map((s) => s.clientMsgId)).size).toBe(1)
    expect(model.getSnapshot().pending).toEqual([])
  })

  it('drops a pending message that the history already has (its answer was lost)', async () => {
    const own = message(50, { authorId: 'me', clientMsgId: '00000000-0000-4000-8000-000000000001' })
    const { model } = setup([{ messages: [], nextBefore: null }, { messages: [own], nextBefore: null }])
    const fake = fakeLink()
    fake.answerWith(() => new Promise<ChatMessage>(() => undefined))
    model.attach(fake.link)
    await flush()
    model.send('lost answer')
    await model.refresh()
    expect(model.getSnapshot().pending).toEqual([])
    expect(model.getSnapshot().history.messages).toEqual([own])
  })
})

describe('ChatModel unread and read state', () => {
  it('counts live messages while not reading, and reads them all when the user looks', async () => {
    const { model, advance } = setup([{ messages: [message(1)], nextBefore: null }], { count: 1, mentions: 0, lastReadId: null })
    const fake = fakeLink()
    model.attach(fake.link)
    await flush()
    expect(model.getSnapshot().unread).toEqual({ count: 1, mentions: 0 })
    fake.push(message(2, { body: `${mentionToken('me')} hi` }))
    fake.push(message(2, { body: `${mentionToken('me')} hi` }))
    fake.push(message(3, { authorId: 'me' }))
    expect(model.getSnapshot().unread).toEqual({ count: 2, mentions: 1 })

    model.setReading(true)
    expect(model.getSnapshot().unread).toEqual({ count: 0, mentions: 0 })
    expect(fake.reads).toEqual([idOf(3)])
    // While reading, new messages are read at once, but chat:read goes out at most once per second.
    fake.push(message(4))
    fake.push(message(5))
    expect(model.getSnapshot().unread.count).toBe(0)
    expect(fake.reads).toEqual([idOf(3)])
    advance(READ_THROTTLE_MS)
    expect(fake.reads).toEqual([idOf(3), idOf(5)])
  })

  it('hides blocked authors from the counts and from notifications, and uncounts a deleted message', async () => {
    const { model } = setup()
    const fake = fakeLink()
    const incoming: string[] = []
    model.onIncoming((m) => incoming.push(m.authorId))
    model.setBlocked(new Set(['troll']))
    model.attach(fake.link)
    await flush()
    fake.push(message(1, { authorId: 'troll' }))
    fake.push(message(2, { authorId: 'bob' }))
    expect(model.getSnapshot().unread.count).toBe(1)
    expect(incoming).toEqual(['bob'])
    fake.deleted(idOf(2))
    expect(model.getSnapshot().unread.count).toBe(0)
    expect(model.getSnapshot().history.messages[1]).toMatchObject({ body: '', deletedAt: expect.any(String) })
  })

  it('sends a read state again that was dropped while offline', async () => {
    const { model, advance } = setup([{ messages: [message(1), message(2)], nextBefore: null }, { messages: [message(1), message(2)], nextBefore: null }], {
      count: 0,
      mentions: 0,
      lastReadId: idOf(1),
    })
    const fake = fakeLink()
    model.attach(fake.link)
    await flush()
    model.setReading(true)
    expect(fake.reads).toEqual([idOf(2)])
    model.setReading(false)
    await model.refresh()
    // The server still says idOf(1): the read of idOf(2) did not arrive. It goes out again after the cooldown.
    expect(model.getSnapshot().lastReadId).toBe(idOf(2))
    advance(READ_THROTTLE_MS)
    expect(fake.reads).toEqual([idOf(2), idOf(2)])
  })
})

describe('ChatModel history', () => {
  it('loads older pages with the keyset cursor, once at a time', async () => {
    const newest = { messages: Array.from({ length: 50 }, (_, i) => message(100 - i)), nextBefore: idOf(51) }
    const older = { messages: Array.from({ length: 50 }, (_, i) => message(50 - i)), nextBefore: null }
    const { model, requests } = setup([newest, older])
    model.attach(fakeLink().link)
    await flush()
    const first = model.loadOlder()
    void model.loadOlder()
    await first
    expect(requests).toEqual([undefined, idOf(51)])
    const list = model.getSnapshot().history.messages.map((m) => numberOf(m.id))
    expect(list).toEqual(Array.from({ length: 100 }, (_, i) => i + 1))
    await model.loadOlder()
    expect(requests).toHaveLength(2)
  })
})
