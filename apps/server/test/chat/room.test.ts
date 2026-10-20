import { MSG, ROOM_NAME, mentionToken, type ChatMessage, type OrgRole } from '@vo/shared'
import { Client } from '@colyseus/sdk'
import { ErrorCode } from '@colyseus/core'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { loadMap, sleep, startRoomServer, waitFor, type RoomServer, type TestPlayer } from '../rooms/harness.ts'
import { startChatDb, type ChatTestDb, type Member } from './fixtures.ts'

// The chat requests of the office room with SDK clients, on a test database.
let t: ChatTestDb
let rs: RoomServer
let companies = 0

beforeAll(async () => {
  t = await startChatDb()
  rs = await startRoomServer(await loadMap(), { services: t.services })
})
afterAll(async () => {
  await rs.close()
  await t.close()
})

async function office(...people: [string, OrgRole][]) {
  const company = await t.company(`Room${++companies}`)
  const members: Member[] = []
  for (const [name, role] of people) {
    const m = await company.join(name, role)
    rs.grant(m, company.officeId, role)
    members.push(m)
  }
  const scope = { orgId: company.orgId, officeId: company.officeId }
  return { company, scope, members, join: (m: Member) => rs.join(m, company.officeId) }
}

const send = (p: TestPlayer, body: string, clientMsgId: string = randomUUID()): Promise<{ ok: true; message: ChatMessage }> =>
  p.room.request(MSG.chatSend, { clientMsgId, body })
const rejected = (reason: string) => ({ name: 'rejected', reason })
const chatNews = (p: TestPlayer) => p.received<ChatMessage>(MSG.chatNew)

describe('chat:send', () => {
  it('stores a message before the others get it, and never echoes it to its author', async () => {
    const { scope, members, join } = await office(['Ann', 'member'], ['Ben', 'member'])
    const [ann, ben] = members as [Member, Member]
    const a = await join(ann)
    const b = await join(ben)
    const storedWhenHeard: boolean[] = []
    b.room.onMessage(MSG.chatNew, (message: ChatMessage) => {
      // Issued as soon as the message arrives; PGlite runs queries in order, so it sees what was committed.
      void t.services.chat.list(scope, ben, { limit: 50 }).then((page) => storedWhenHeard.push(page.messages.some((m) => m.id === message.id)))
    })
    const answer = await send(a, 'Hello, Ben')
    expect(answer).toMatchObject({ ok: true, message: { body: 'Hello, Ben', authorId: ann.userId, authorName: 'Ann', deletedAt: null } })
    await waitFor(() => storedWhenHeard.length === 1, 'ben to get chat:new')
    expect(storedWhenHeard).toEqual([true])
    await sleep(100)
    expect(chatNews(a)).toEqual([])
    await Promise.all([a.leave(), b.leave()])
  })

  it('answers a retry with the stored message and broadcasts it once', async () => {
    const { members, join } = await office(['Ann', 'member'], ['Ben', 'member'])
    const [ann, ben] = members as [Member, Member]
    const a = await join(ann)
    const b = await join(ben)
    const clientMsgId = randomUUID()
    const first = await send(a, 'once', clientMsgId)
    const again = await send(a, 'twice?', clientMsgId)
    expect(again).toEqual(first)
    await waitFor(() => chatNews(b).length === 1, 'chat:new')
    await sleep(150)
    expect(chatNews(b).map((m) => m.body)).toEqual(['once'])
    await Promise.all([a.leave(), b.leave()])
  })

  it('broadcasts nothing when the message cannot be stored', async () => {
    const { scope, members, join } = await office(['Ann', 'member'], ['Ben', 'member'])
    const [ann, ben] = members as [Member, Member]
    const a = await join(ann)
    const b = await join(ben)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const transaction = vi.spyOn(t.handle.db, 'transaction').mockRejectedValueOnce(new Error('database down'))
    try {
      await expect(send(a, 'lost')).rejects.toMatchObject(rejected('invalid'))
      expect(errors).toHaveBeenCalled()
    } finally {
      transaction.mockRestore()
      errors.mockRestore()
    }
    await sleep(150)
    expect(chatNews(b)).toEqual([])
    expect((await t.services.chat.list(scope, ann, { limit: 50 })).messages).toEqual([])
    // The failed message did not use up the rate limit.
    for (let i = 0; i < 5; i++) await send(a, `m${i}`)
    await waitFor(() => chatNews(b).length === 5, 'five messages')
    await Promise.all([a.leave(), b.leave()])
  })

  it('rejects the sixth message within 10 s, and accepts messages again after the window', async () => {
    const { members, join } = await office(['Ann', 'member'], ['Ben', 'member'])
    const [ann, ben] = members as [Member, Member]
    const a = await join(ann)
    const b = await join(ben)
    const answers = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => send(a, `burst ${i}`)))
    expect(answers.filter((r) => r.status === 'fulfilled')).toHaveLength(5)
    expect(answers.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason)).toMatchObject([rejected('rate_limited')])
    t.clock.advance(9_999)
    await expect(send(a, 'too soon')).rejects.toMatchObject(rejected('rate_limited'))
    t.clock.advance(1)
    await send(a, 'after the window')
    await waitFor(() => chatNews(b).length === 6, 'six messages')
    expect(chatNews(b).at(-1)?.body).toBe('after the window')
    await Promise.all([a.leave(), b.leave()])
  })

  it('tells each recipient whether the message mentions them, never across a block', async () => {
    const { company, members, join } = await office(['Ann', 'member'], ['Ben', 'member'], ['Cy', 'member'])
    const [ann, ben, cy] = members as [Member, Member, Member]
    await t.services.prefs.setBlocked(company.orgId, ann.userId, ben.userId, true)
    const [a, b, c] = await Promise.all([join(ann), join(ben), join(cy)])
    const answer = await send(a, `<!everyone> and ${mentionToken(ben.userId)}`)
    expect(answer.message.mentionsYou).toBe(false)
    await send(a, `just ${mentionToken(cy.userId)}`)
    await waitFor(() => chatNews(b).length === 2 && chatNews(c).length === 2, 'two messages each')
    // Ann blocked Ben: neither her everyone nor her mention of him counts for him; both count for Cy.
    expect(chatNews(b).map((m) => m.mentionsYou)).toEqual([false, false])
    expect(chatNews(c).map((m) => m.mentionsYou)).toEqual([true, true])
    // The other way: Ben mentions Ann, who blocked him.
    await send(b, `hi ${mentionToken(ann.userId)} <!everyone>`)
    await waitFor(() => chatNews(a).length === 1 && chatNews(c).length === 3, 'ben to be heard')
    expect(chatNews(a)[0]?.mentionsYou).toBe(false)
    expect(chatNews(c)[2]?.mentionsYou).toBe(true)
    await Promise.all([a.leave(), b.leave(), c.leave()])
  })

  it('carries 2,000 characters of a multibyte script over the WebSocket and rejects 2,001', async () => {
    const { members, join } = await office(['Ann', 'member'], ['Ben', 'member'])
    const [ann, ben] = members as [Member, Member]
    const a = await join(ann)
    const b = await join(ben)
    const long = '日'.repeat(2000)
    expect((await send(a, long)).message.body).toBe(long)
    expect((await send(a, '\u{1f600}'.repeat(1000))).message.body).toHaveLength(2000)
    await expect(send(a, '日'.repeat(2001))).rejects.toMatchObject(rejected('too_long'))
    await expect(send(a, '   ')).rejects.toMatchObject(rejected('empty'))
    await expect(a.room.request(MSG.chatSend, { body: 'no id' })).rejects.toMatchObject(rejected('invalid'))
    await waitFor(() => chatNews(b).length === 2, 'two messages')
    expect(chatNews(b)[0]?.body).toBe(long)
    expect(a.closeCode).toBeNull()
    await Promise.all([a.leave(), b.leave()])
  })
})

describe('chat:delete', () => {
  it('lets the author, an owner or an admin delete, and tells everyone', async () => {
    const { members, join } = await office(['Ann', 'member'], ['Ben', 'member'], ['Ada', 'admin'])
    const [ann, ben, ada] = members as [Member, Member, Member]
    const [a, b, d] = await Promise.all([join(ann), join(ben), join(ada)])
    const first = (await send(a, 'first')).message
    const second = (await send(a, 'second')).message
    await expect(b.room.request(MSG.chatDelete, { id: first.id })).rejects.toMatchObject(rejected('not_allowed'))
    expect(await a.room.request(MSG.chatDelete, { id: first.id })).toEqual({ ok: true })
    expect(await d.room.request(MSG.chatDelete, { id: second.id.toUpperCase() })).toEqual({ ok: true })
    await expect(d.room.request(MSG.chatDelete, { id: second.id })).rejects.toMatchObject(rejected('not_found'))
    await expect(d.room.request(MSG.chatDelete, { id: 'nope' })).rejects.toMatchObject(rejected('invalid'))
    for (const p of [a, b, d]) {
      await waitFor(() => p.received(MSG.chatDeleted).length === 2, 'chat:deleted')
      expect(p.received(MSG.chatDeleted)).toEqual([{ id: first.id }, { id: second.id }])
    }
    await Promise.all([a.leave(), b.leave(), d.leave()])
  })
})

describe('chat:read', () => {
  it('moves the read state forward, coalescing a burst', async () => {
    const { scope, members, join } = await office(['Ann', 'member'], ['Ben', 'member'])
    const [ann, ben] = members as [Member, Member]
    const a = await join(ann)
    const b = await join(ben)
    const ids = []
    for (let i = 0; i < 4; i++) ids.push((await send(a, `m${i}`)).message.id)
    const [m0, m1, m2, m3] = ids as [string, string, string, string]
    b.room.send(MSG.chatRead, { lastReadId: m1 })
    for (const lastReadId of [m2, m0, randomUUID(), 'junk']) b.room.send(MSG.chatRead, { lastReadId })
    const unread = () => t.services.chat.unread(scope, ben)
    await vi.waitFor(async () => expect((await unread()).lastReadId).toBe(m2), { timeout: 3000, interval: 50 })
    expect(await unread()).toEqual({ count: 1, mentions: 0, lastReadId: m2, mutedUntil: null })
    b.room.send(MSG.chatRead, { lastReadId: m3 })
    await vi.waitFor(async () => expect((await unread()).lastReadId).toBe(m3), { timeout: 3000, interval: 50 })
    expect(b.closeCode).toBeNull()
    await Promise.all([a.leave(), b.leave()])
  })

  it('writes a read that waits for the interval as soon as the reader leaves', async () => {
    const { scope, members, join } = await office(['Ann', 'member'], ['Ben', 'member'])
    const [ann, ben] = members as [Member, Member]
    const a = await join(ann)
    const b = await join(ben)
    const m1 = (await send(a, 'one')).message.id
    const m2 = (await send(a, 'two')).message.id
    const unread = () => t.services.chat.unread(scope, ben)
    b.room.send(MSG.chatRead, { lastReadId: m1 })
    await vi.waitFor(async () => expect((await unread()).lastReadId).toBe(m1), { timeout: 3000, interval: 20 })
    b.room.send(MSG.chatRead, { lastReadId: m2 })
    await sleep(50)
    await b.leave()
    // Well before the 1 s interval is over.
    await vi.waitFor(async () => expect((await unread()).lastReadId).toBe(m2), { timeout: 400, interval: 20 })
    await a.leave()
  })
})

describe('tenant isolation in the room', () => {
  it('never lets a member of another company in, nor act on its messages from their own office', async () => {
    const mine = await office(['Ann', 'owner'])
    const theirs = await office(['Zoe', 'owner'])
    const [ann] = mine.members as [Member]
    const [zoe] = theirs.members as [Member]
    const a = await mine.join(ann)
    const secret = (await send(a, 'company secret')).message

    const client = new Client(rs.endpoint)
    client.auth.token = await rs.token(zoe, mine.company.officeId)
    await expect(client.joinOrCreate(ROOM_NAME, { officeId: mine.company.officeId })).rejects.toMatchObject({ code: ErrorCode.AUTH_FAILED })

    const z = await theirs.join(zoe)
    await expect(z.room.request(MSG.chatDelete, { id: secret.id })).rejects.toMatchObject(rejected('not_found'))
    z.room.send(MSG.chatRead, { lastReadId: secret.id })
    await sleep(200)
    expect(await t.services.chat.unread(theirs.scope, zoe)).toEqual({ count: 0, mentions: 0, lastReadId: null, mutedUntil: null })
    expect((await t.services.chat.list(theirs.scope, zoe, { limit: 50 })).messages).toEqual([])
    expect(chatNews(z)).toEqual([])
    expect((await t.services.chat.list(mine.scope, ann, { limit: 50 })).messages.map((m) => m.body)).toEqual(['company secret'])
    await Promise.all([a.leave(), z.leave()])
  })
})
