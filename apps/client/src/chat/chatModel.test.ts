import { describe, expect, it } from 'vitest'
import { mentionToken, type ChatHistoryResponse, type ChatMessage, type ChatSendRequest, type ChatUnreadResponse } from '@vo/shared'
import { RequestTimeoutError, type OfficeLink } from '../net/officeLink.ts'
import { ChatModel, READ_THROTTLE_MS, SEND_RETRIES, SEND_RETRY_MS } from './chatModel.ts'
import { NO_ANSWER_TEXT } from './format.ts'
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
  const connection = { open: true }
  let answer: (request: ChatSendRequest) => Promise<ChatMessage> = async (request) => message(900, { authorId: 'me', clientMsgId: request.clientMsgId, body: request.body })
  const link = {
    sendChat: (request: ChatSendRequest) => {
      sends.push(request)
      return answer(request)
    },
    deleteChat: async () => undefined,
    markChatRead: (id: string) => connection.open && reads.push(id) > 0,
    onChatNew: (h: (m: ChatMessage) => void) => (handlers.new.push(h), () => undefined),
    onChatDeleted: (h: (d: { id: string }) => void) => (handlers.deleted.push(h), () => undefined),
    onChatMuted: (h: (m: { until: string | null }) => void) => (handlers.muted.push(h), () => undefined),
  } as unknown as OfficeLink
  return {
    link,
    sends,
    reads,
    connection,
    answerWith: (next: typeof answer) => (answer = next),
    push: (m: ChatMessage) => handlers.new.forEach((h) => h(m)),
    deleted: (id: string) => handlers.deleted.forEach((h) => h({ id })),
    muted: (until: string | null) => handlers.muted.forEach((h) => h({ until })),
  }
}

type Page = ChatHistoryResponse | Promise<ChatHistoryResponse>

// A page that the test hands out when it wants (to land something while a request is on its way).
function held(): { page: Promise<ChatHistoryResponse>; release: (page: ChatHistoryResponse) => void } {
  let release: (page: ChatHistoryResponse) => void = () => undefined
  const page = new Promise<ChatHistoryResponse>((resolve) => (release = resolve))
  return { page, release }
}

// Messages from..to as the server pages them: newest first.
const range = (from: number, to: number, nextBefore: number | null): ChatHistoryResponse => ({
  messages: Array.from({ length: to - from + 1 }, (_, i) => message(to - i)),
  nextBefore: nextBefore === null ? null : idOf(nextBefore),
})

function setup(pages: Page[] = [{ messages: [], nextBefore: null }], counts: Partial<ChatUnreadResponse> = {}) {
  const server = { unread: { count: 0, mentions: 0, lastReadId: null, mutedUntil: null, ...counts } as ChatUnreadResponse }
  const timers: Array<{ run: () => void; at: number; live: boolean }> = []
  let now = 1_000
  const requests: Array<string | undefined> = []
  let ids = 0
  const model = new ChatModel({
    api: {
      chatHistory: async (before) => {
        requests.push(before)
        return (await pages.shift()) ?? { messages: [], nextBefore: null }
      },
      chatUnread: async () => server.unread,
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
  return { model, requests, advance, server }
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
    fake.push(message(2, { body: `${mentionToken('me')} hi`, mentionsYou: true }))
    fake.push(message(2, { body: `${mentionToken('me')} hi`, mentionsYou: true }))
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

describe('ChatModel after a lost connection', () => {
  it('leaves no hole when a live message lands before the newest page after a reconnect', async () => {
    const reload = held()
    const { model } = setup([range(71, 120, 71), reload.page])
    const fake = fakeLink()
    model.attach(fake.link)
    await flush()
    // 121..200 are sent while the connection is down; after the reconnect 201 comes live before the page.
    model.dropped()
    model.reconnected()
    fake.push(message(201))
    reload.release(range(152, 201, 152))
    await flush()
    const { history } = model.getSnapshot()
    expect(history.messages.map((m) => numberOf(m.id))).toEqual(Array.from({ length: 50 }, (_, i) => i + 152))
    expect(history.nextBefore).toBe(idOf(152))
  })

  it('leaves no hole when the answer to a message sent offline lands first, on a new connection', async () => {
    const reload = held()
    const { model } = setup([range(71, 120, 71), reload.page])
    const first = fakeLink()
    const detach = model.attach(first.link)
    await flush()
    detach()
    model.send('typed while away')
    const second = fakeLink()
    second.answerWith(async (request) => message(201, { authorId: 'me', clientMsgId: request.clientMsgId, body: request.body }))
    model.attach(second.link)
    await flush()
    reload.release(range(152, 201, 152))
    await flush()
    const { history, pending } = model.getSnapshot()
    expect(pending).toEqual([])
    expect(history.messages.map((m) => numberOf(m.id))).toEqual(Array.from({ length: 50 }, (_, i) => i + 152))
    expect(history.nextBefore).toBe(idOf(152))
  })

  it('takes the mute state of the server at a reconnect (an unmute it did not hear of)', async () => {
    const { model, server } = setup([range(1, 3, null), range(1, 3, null)])
    const fake = fakeLink()
    model.attach(fake.link)
    await flush()
    fake.muted(new Date(1_000 + 7 * 86_400_000).toISOString())
    expect(model.getSnapshot().mutedUntil).not.toBeNull()
    model.dropped()
    server.unread = { ...server.unread, mutedUntil: null }
    model.reconnected()
    await flush()
    expect(model.getSnapshot().mutedUntil).toBeNull()
  })

  it('does not count what the user read while a chat:read could not go out, and sends it again', async () => {
    const { model, server } = setup([range(1, 3, null), range(1, 3, null)], { count: 3 })
    const fake = fakeLink()
    model.attach(fake.link)
    await flush()
    expect(model.getSnapshot().unread.count).toBe(3)
    fake.connection.open = false
    model.setReading(true)
    expect(model.getSnapshot()).toMatchObject({ unread: { count: 0 }, lastReadId: idOf(3) })
    model.setReading(false)
    expect(fake.reads).toEqual([])
    // The server never got the read: it still counts 3.
    server.unread = { ...server.unread, count: 3, lastReadId: null }
    fake.connection.open = true
    model.dropped()
    model.reconnected()
    await flush()
    expect(model.getSnapshot().unread).toEqual({ count: 0, mentions: 0 })
    expect(fake.reads).toEqual([idOf(3)])
  })
})

describe('ChatModel deletes and timeouts', () => {
  it('shows a message deleted while its page was loading as deleted, and counts it no more', async () => {
    const first = held()
    const { model, server } = setup([first.page], { count: 2 })
    const fake = fakeLink()
    model.attach(fake.link)
    server.unread = { ...server.unread, count: 1 }
    fake.deleted(idOf(2))
    first.release(range(1, 2, null))
    await flush()
    expect(model.getSnapshot().history.messages[1]).toMatchObject({ body: '', deletedAt: expect.any(String) })
    expect(model.getSnapshot().unread).toEqual({ count: 1, mentions: 0 })
  })

  it('shows a message deleted while an older page was loading as deleted', async () => {
    const older = held()
    const { model } = setup([range(51, 100, 51), older.page])
    const fake = fakeLink()
    model.attach(fake.link)
    await flush()
    const loading = model.loadOlder()
    fake.deleted(idOf(40))
    older.release(range(1, 50, null))
    await loading
    expect(model.getSnapshot().history.messages.find((m) => m.id === idOf(40))).toMatchObject({ body: '', deletedAt: expect.any(String) })
  })

  it('sends a message again with its clientMsgId when the answer is late, then shows it as not confirmed', async () => {
    const { model, advance } = setup()
    const fake = fakeLink()
    model.attach(fake.link)
    await flush()
    fake.answerWith(async () => {
      throw new RequestTimeoutError('request "chat:send" timed out after 8000ms.')
    })
    model.send('slow server')
    await flush()
    expect(model.getSnapshot().pending[0]).toMatchObject({ status: 'sending' })
    for (let i = 0; i < SEND_RETRIES; i++) {
      advance(SEND_RETRY_MS * 2 ** i)
      await flush()
    }
    expect(fake.sends).toHaveLength(SEND_RETRIES + 1)
    expect(new Set(fake.sends.map((r) => r.clientMsgId)).size).toBe(1)
    expect(model.getSnapshot().pending[0]).toMatchObject({ status: 'failed', error: NO_ANSWER_TEXT, retryOnReconnect: true })

    // A late answer on the next try: stored once.
    fake.answerWith(async (request) => message(910, { authorId: 'me', clientMsgId: request.clientMsgId, body: request.body }))
    model.retry(model.getSnapshot().pending[0]?.clientMsgId ?? '')
    await flush()
    expect(model.getSnapshot().pending).toEqual([])
    expect(model.getSnapshot().history.messages.map((m) => m.body)).toEqual(['slow server'])
  })
})
