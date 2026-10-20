import { auditLog, forOrg } from '@vo/db'
import { CHAT_PAGE_SIZE, CHAT_RATE_LIMIT, UNREAD_COUNT_LIMIT, mentionToken, unreadBadge, type ChatMessage } from '@vo/shared'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ChatScope, ChatSendResult } from '../../src/chat/chatService.ts'
import { startChatDb, type ChatTestDb, type Company, type Member } from './fixtures.ts'

let t: ChatTestDb
let companies = 0

beforeAll(async () => {
  t = await startChatDb()
})
afterAll(() => t.close())

const scopeOf = (company: Company): ChatScope => ({ orgId: company.orgId, officeId: company.officeId })
const chat = () => t.services.chat

async function office() {
  const company = await t.company(`Co${++companies}`)
  return { company, scope: scopeOf(company) }
}

function say(scope: ChatScope, author: Member, body: string, clientMsgId: string = randomUUID()): Promise<ChatSendResult> {
  return chat().send(scope, author, { clientMsgId, body })
}

async function sent(scope: ChatScope, author: Member, body: string): Promise<ChatMessage> {
  const result = await say(scope, author, body)
  if (!result.ok) throw new Error(`send failed: ${result.reason}`)
  return result.message
}

// Messages written straight to the table (no rate limit), all with one created_at.
async function seed(company: Company, author: Member, count: number, createdAt = new Date(t.clock.ms)): Promise<string[]> {
  const tenant = forOrg(t.handle.db, company.orgId)
  const ids: string[] = []
  for (let i = 0; i < count; i++) {
    const stored = await tenant.insertChatMessage({
      officeId: company.officeId,
      authorId: author.userId,
      clientMsgId: randomUUID(),
      body: `m${i}`,
      mentionsEveryone: false,
      mentionUserIds: [],
      createdAt,
    })
    if (stored === null) throw new Error('seed failed')
    ids.push(stored.message.id)
  }
  return ids
}

const reason = (result: ChatSendResult) => (result.ok ? 'ok' : result.reason)

describe('chat send', () => {
  it('stores a message and answers a retry with the stored one, outside the rate limit', async () => {
    const { company, scope } = await office()
    const ann = await company.join('Ann')
    const clientMsgId = randomUUID()
    const first = await say(scope, ann, ' hello ', clientMsgId)
    expect(first).toMatchObject({ ok: true, created: true, message: { body: 'hello', authorId: ann.userId, authorName: 'Ann', clientMsgId, deletedAt: null } })
    const retry = await say(scope, ann, 'changed', clientMsgId.toUpperCase())
    expect(retry).toEqual({ ok: true, created: false, message: first.ok ? first.message : null, mentions: { userIds: [], everyone: false } })

    for (let i = 0; i < CHAT_RATE_LIMIT.messages - 1; i++) await sent(scope, ann, `more ${i}`)
    expect(reason(await say(scope, ann, 'again', clientMsgId))).toBe('ok')
    expect(reason(await say(scope, ann, 'one too many'))).toBe('rate_limited')
    expect((await chat().list(scope, ann, { limit: 50 })).messages).toHaveLength(CHAT_RATE_LIMIT.messages)
  })

  it('rejects the sixth message within 10 s and accepts one again after the window', async () => {
    const { company, scope } = await office()
    const ann = await company.join('Ann')
    for (let i = 0; i < 5; i++) {
      expect(reason(await say(scope, ann, `m${i}`))).toBe('ok')
      t.clock.advance(1000)
    }
    expect(reason(await say(scope, ann, 'sixth'))).toBe('rate_limited')
    // The first message was sent 5 s ago.
    t.clock.advance(4_999)
    expect(reason(await say(scope, ann, 'still too soon'))).toBe('rate_limited')
    t.clock.advance(1)
    expect(reason(await say(scope, ann, 'after the window'))).toBe('ok')
    expect(reason(await say(scope, ann, 'next'))).toBe('rate_limited')
  })

  it('normalizes the body and checks its length in UTF-16 code units', async () => {
    const { company, scope } = await office()
    const ann = await company.join('Ann')
    const bob = await company.join('Bob')
    const cy = await company.join('Cy')
    expect((await sent(scope, ann, '  line one\r\nline two\u202E\u0007  ')).body).toBe('line one\nline two')
    expect(reason(await say(scope, ann, ' \n\t\u0000 '))).toBe('empty')
    expect(reason(await say(scope, ann, ''))).toBe('empty')
    expect((await sent(scope, ann, 'x'.repeat(2000))).body).toHaveLength(2000)
    expect(reason(await say(scope, bob, 'x'.repeat(2001)))).toBe('too_long')
    expect((await sent(scope, bob, '😀'.repeat(1000))).body).toHaveLength(2000)
    expect(reason(await say(scope, cy, `${'😀'.repeat(1000)}a`))).toBe('too_long')
    expect(reason(await chat().send(scope, cy, { clientMsgId: 'not-a-uuid', body: 'hi' }))).toBe('invalid')
    expect(reason(await chat().send(scope, cy, { body: 'hi' } as never))).toBe('invalid')
  })

  it('rejects a muted author with the end of the mute, which the unread counts tell too', async () => {
    const { company, scope } = await office()
    const admin = await company.join('Ada', 'admin')
    const bob = await company.join('Bob')
    const muted = await t.services.moderation.mute(company.orgId, admin, bob.userId, 15)
    expect(muted.ok).toBe(true)
    const until = muted.ok ? muted.until : null
    expect(await say(scope, bob, 'hi')).toEqual({ ok: false, reason: 'muted', mutedUntil: until })
    expect((await chat().unread(scope, bob)).mutedUntil).toBe(until?.toISOString())
    expect((await chat().unread(scope, admin)).mutedUntil).toBeNull()
    t.clock.advance(15 * 60_000)
    expect(reason(await say(scope, bob, 'hi again'))).toBe('ok')
  })

  it('refuses authors who are not members of the company', async () => {
    const { scope } = await office()
    const outsider = await (await t.company('Other')).join('Eve')
    expect(reason(await say(scope, outsider, 'hi'))).toBe('invalid')
  })

  it('notifies members other than the author, and nobody across a block', async () => {
    const { company, scope } = await office()
    const ann = await company.join('Ann')
    const bob = await company.join('Bob')
    const dee = await company.join('Dee')
    const eli = await company.join('Eli')
    const outsider = await (await t.company('Elsewhere')).join('Zed')
    await t.services.prefs.setBlocked(company.orgId, dee.userId, ann.userId, true)
    await t.services.prefs.setBlocked(company.orgId, ann.userId, eli.userId, true)
    const body = [bob, outsider, ann, dee, eli].map((m) => mentionToken(m.userId)).join(' ') + ' <@nobody>'
    expect((await sent(scope, ann, body)).body).toBe(body)
    const mentions = async (m: Member) => (await chat().unread(scope, m)).mentions
    expect(await mentions(bob)).toBe(1)
    expect(await mentions(dee)).toBe(0)
    expect(await mentions(eli)).toBe(0)
    expect(await mentions(ann)).toBe(0)
  })

  it('never counts a mention across a block in either direction, everyone included, as the blocks stand now', async () => {
    const { company, scope } = await office()
    const ann = await company.join('Ann')
    const bob = await company.join('Bob')
    const dee = await company.join('Dee')
    await t.services.prefs.setBlocked(company.orgId, ann.userId, bob.userId, true)
    const direct = await say(scope, ann, `hey ${mentionToken(bob.userId)}`)
    const everyone = await say(scope, ann, '<!everyone> standup')
    expect(direct).toMatchObject({ ok: true, mentions: { userIds: [], everyone: false } })
    expect(everyone).toMatchObject({ ok: true, mentions: { userIds: [], everyone: true } })
    // Bob (whom Ann blocked) still sees her messages, but neither mentions him; Dee is mentioned by the everyone.
    expect(await chat().unread(scope, bob)).toMatchObject({ count: 2, mentions: 0 })
    expect(await chat().unread(scope, dee)).toMatchObject({ count: 2, mentions: 1 })
    const mentionsYou = async (m: Member) => (await chat().list(scope, m, { limit: 50 })).messages.map((x) => x.mentionsYou)
    expect(await mentionsYou(bob)).toEqual([false, false])
    expect(await mentionsYou(dee)).toEqual([true, false])
    expect(await mentionsYou(ann)).toEqual([false, false])

    // The other direction, and a block made after the message: Dee blocks Ann, and the everyone no longer counts.
    await t.services.prefs.setBlocked(company.orgId, dee.userId, ann.userId, true)
    expect(await chat().unread(scope, dee)).toMatchObject({ count: 0, mentions: 0 })
    expect(await mentionsYou(dee)).toEqual([false, false])
    // Unblocked: the everyone counts for Bob again; the direct mention got no mention row when it was sent.
    await t.services.prefs.setBlocked(company.orgId, ann.userId, bob.userId, false)
    expect(await mentionsYou(bob)).toEqual([true, false])
  })

  it('tells who of the people in the room a new message mentions', async () => {
    const { company, scope } = await office()
    const [ann, bob, cy, dee] = await Promise.all(['Ann', 'Bob', 'Cy', 'Dee'].map((name) => company.join(name)))
    if (!ann || !bob || !cy || !dee) throw new Error('members')
    await t.services.prefs.setBlocked(company.orgId, dee.userId, ann.userId, true)
    const everyone = [ann, bob, cy, dee].map((m) => m.userId)
    const among = (mentions: { userIds: string[]; everyone: boolean }) => chat().mentionedAmong(scope, ann.userId, mentions, everyone)
    expect(await among({ userIds: [bob.userId], everyone: false })).toEqual(new Set([bob.userId]))
    expect(await among({ userIds: [], everyone: true })).toEqual(new Set([bob.userId, cy.userId]))
    expect(await among({ userIds: [dee.userId, ann.userId], everyone: false })).toEqual(new Set())
    expect(await among({ userIds: [], everyone: false })).toEqual(new Set())
  })

  it("turns a guest's everyone token into text, and counts a member's for everyone", async () => {
    const { company, scope } = await office()
    const ann = await company.join('Ann')
    const gus = await company.join('Gus', 'guest')
    const bob = await company.join('Bob')
    expect((await sent(scope, gus, '<!everyone> hi')).body).toBe('@everyone hi')
    expect(await chat().unread(scope, bob)).toMatchObject({ count: 1, mentions: 0 })
    expect((await sent(scope, ann, `<!everyone> and ${mentionToken(bob.userId)}`)).body).toContain('<!everyone>')
    expect(await chat().unread(scope, bob)).toMatchObject({ count: 2, mentions: 1 })
    expect(await chat().unread(scope, gus)).toMatchObject({ count: 1, mentions: 1 })
  })
})

describe('chat history', () => {
  it('pages back 120 messages with the same timestamp, each exactly once', async () => {
    const { company, scope } = await office()
    const ann = await company.join('Ann')
    const ids = await seed(company, ann, 120)
    for (const limit of [CHAT_PAGE_SIZE, 7]) {
      const seen: string[] = []
      let before: string | undefined
      let pages = 0
      for (;;) {
        const page = await chat().list(scope, ann, { before, limit })
        seen.push(...page.messages.map((m) => m.id))
        pages++
        if (page.nextBefore === null) break
        expect(page.messages).toHaveLength(limit)
        before = page.nextBefore
      }
      expect(pages).toBe(Math.ceil(120 / limit))
      expect(seen).toEqual([...ids].reverse())
    }
  })

  it('shows a guest only the messages since they joined, in history and unread', async () => {
    const { company, scope } = await office()
    const ann = await company.join('Ann')
    await sent(scope, ann, 'before 1')
    t.clock.advance(10)
    await sent(scope, ann, 'before 2')
    t.clock.advance(10)
    const gus = await company.join('Gus', 'guest', new Date(t.clock.ms))
    const atJoin = await sent(scope, ann, 'at the join time')
    t.clock.advance(10)
    const after = await sent(scope, ann, 'after')
    await chat().delete(scope, ann, after.id)

    const history = await chat().list(scope, gus, { limit: 50 })
    expect(history.messages.map((m) => [m.id, m.body])).toEqual([
      [after.id, ''],
      [atJoin.id, 'at the join time'],
    ])
    expect(history.messages[0]?.deletedAt).not.toBeNull()
    expect(history.nextBefore).toBeNull()
    expect(await chat().list(scope, gus, { limit: 50, before: atJoin.id })).toEqual({ messages: [], nextBefore: null })
    expect(await chat().unread(scope, gus)).toEqual({ count: 1, mentions: 0, lastReadId: null, mutedUntil: null })
    expect((await chat().list(scope, ann, { limit: 50 })).messages).toHaveLength(4)
  })

  it('includes the messages of people the viewer blocked', async () => {
    const { company, scope } = await office()
    const ann = await company.join('Ann')
    const bob = await company.join('Bob')
    await t.services.prefs.setBlocked(company.orgId, ann.userId, bob.userId, true)
    const message = await sent(scope, bob, 'hello Ann')
    expect((await chat().list(scope, ann, { limit: 50 })).messages.map((m) => m.id)).toEqual([message.id])
  })
})

describe('chat delete', () => {
  it('lets the author, an owner or an admin delete a message, and nobody else', async () => {
    const { company, scope } = await office()
    const ann = await company.join('Ann')
    const bob = await company.join('Bob')
    const ada = await company.join('Ada', 'admin')
    const own = await company.join('Olga', 'owner')
    const first = await sent(scope, ann, 'first')
    const second = await sent(scope, ann, 'second')
    const third = await sent(scope, ada, 'third')

    expect(await chat().delete(scope, bob, first.id)).toEqual({ ok: false, reason: 'not_allowed' })
    expect(await chat().delete(scope, ann, first.id)).toEqual({ ok: true })
    expect(await chat().delete(scope, ann, first.id)).toEqual({ ok: false, reason: 'not_found' })
    expect(await chat().delete(scope, ada, second.id)).toEqual({ ok: true })
    expect(await chat().delete(scope, own, third.id)).toEqual({ ok: true })
    expect(await chat().delete(scope, ann, 'nope')).toEqual({ ok: false, reason: 'invalid' })
    expect(await chat().delete(scope, ann, randomUUID())).toEqual({ ok: false, reason: 'not_found' })

    const page = await chat().list(scope, bob, { limit: 50 })
    expect(page.messages.map((m) => [m.body, m.deletedAt !== null])).toEqual([
      ['', true],
      ['', true],
      ['', true],
    ])
    const entries = (await t.handle.db.select().from(auditLog)).filter((e) => e.orgId === company.orgId)
    expect(entries.map((e) => [e.action, e.actorId, e.targetId])).toEqual([
      ['chat.delete', ada.userId, second.id],
      ['chat.delete', own.userId, third.id],
    ])
    expect(JSON.stringify(entries)).not.toContain('second')
  })
})

describe('read state and unread counts', () => {
  it('moves the read state only forward and ignores ids outside the office', async () => {
    const { company, scope } = await office()
    const ann = await company.join('Ann')
    const bob = await company.join('Bob')
    const ids = [await sent(scope, ann, 'a'), await sent(scope, ann, 'b'), await sent(scope, ann, 'c')].map((m) => m.id)
    await chat().markRead(scope, bob.userId, ids[1] ?? '')
    await chat().markRead(scope, bob.userId, ids[0] ?? '')
    expect(await chat().unread(scope, bob)).toEqual({ count: 1, mentions: 0, lastReadId: ids[1], mutedUntil: null })
    await chat().markRead(scope, bob.userId, randomUUID())
    await chat().markRead(scope, bob.userId, 'not-a-uuid')
    const other = await office()
    const zed = await other.company.join('Zed')
    await chat().markRead(scope, bob.userId, (await sent(other.scope, zed, 'elsewhere')).id)
    expect((await chat().unread(scope, bob)).lastReadId).toBe(ids[1])
    await chat().markRead(scope, bob.userId, (ids[2] ?? '').toUpperCase())
    expect(await chat().unread(scope, bob)).toEqual({ count: 0, mentions: 0, lastReadId: ids[2], mutedUntil: null })
  })

  it('counts the messages of others only, without blocked authors, up to the limit', async () => {
    const { company, scope } = await office()
    const ann = await company.join('Ann')
    const bob = await company.join('Bob')
    const cy = await company.join('Cy')
    await sent(scope, ann, 'mine')
    await sent(scope, bob, `${mentionToken(ann.userId)} hi`)
    await sent(scope, cy, 'from Cy')
    expect(await chat().unread(scope, ann)).toEqual({ count: 2, mentions: 1, lastReadId: null, mutedUntil: null })
    await t.services.prefs.setBlocked(company.orgId, ann.userId, cy.userId, true)
    expect(await chat().unread(scope, ann)).toEqual({ count: 1, mentions: 1, lastReadId: null, mutedUntil: null })

    await seed(company, bob, 120)
    const capped = await chat().unread(scope, ann)
    expect(capped.count).toBe(UNREAD_COUNT_LIMIT)
    expect(unreadBadge(capped.count)).toBe('99+')
  })
})

describe('tenant isolation', () => {
  it('gives a member of another company nothing in this office', async () => {
    const { company, scope } = await office()
    const ann = await company.join('Ann')
    const message = await sent(scope, ann, 'internal')
    const zed = await (await t.company('Rival')).join('Zed', 'owner')
    expect(await chat().list(scope, zed, { limit: 50 })).toEqual({ messages: [], nextBefore: null })
    expect(await chat().unread(scope, zed)).toEqual({ count: 0, mentions: 0, lastReadId: null, mutedUntil: null })
    expect(reason(await say(scope, zed, 'hi'))).toBe('invalid')
    expect(await chat().delete(scope, zed, message.id)).toEqual({ ok: false, reason: 'not_allowed' })
    // The message's id under the rival company's own office finds nothing.
    const rival = await office()
    const rivalOwner = await rival.company.join('Rex', 'owner')
    expect(await chat().delete(rival.scope, rivalOwner, message.id)).toEqual({ ok: false, reason: 'not_found' })
    expect((await chat().list(scope, ann, { limit: 50 })).messages.map((m) => m.body)).toEqual(['internal'])
  })
})
