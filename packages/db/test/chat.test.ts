import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, forOrg, member, messageIdTime, newId, newMessageId, organization, user, type DbHandle } from '../src/index.ts'

let handle: DbHandle

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

async function company(name: string, joinedAt = new Date()) {
  const orgId = newId()
  await handle.db.insert(organization).values({ id: orgId, name, slug: `${name}-${orgId}`, createdAt: new Date() })
  const tenant = forOrg(handle.db, orgId)
  const office = await tenant.createOffice({ name: 'HQ', templateId: 't', templateVersion: 1 })
  const join = async (userName: string, role = 'member', at = joinedAt) => {
    const id = newId()
    await handle.db.insert(user).values({ id, name: userName, email: `${userName}-${id}@example.com` })
    await handle.db.insert(member).values({ id: newId(), organizationId: orgId, userId: id, role, createdAt: at })
    return id
  }
  return { tenant, officeId: office.id, join }
}

beforeAll(async () => {
  handle = await createDb({ PGLITE_DIR: 'memory://' })
})

afterAll(async () => {
  await handle.close()
})

describe('newMessageId', () => {
  it('makes uuidv7 ids that increase within one millisecond and when the clock goes back', () => {
    const ids = [newMessageId(5_000), ...Array.from({ length: 5000 }, () => newMessageId(5_000)), newMessageId(4_000)]
    for (const id of ids) expect(id).toMatch(UUID)
    expect([...ids].sort()).toEqual(ids)
    expect(new Set(ids).size).toBe(ids.length)
    const now = Date.now()
    expect(messageIdTime(newMessageId(now))).toBe(now)
  })
})

describe('chat messages', () => {
  it('stores a message once per clientMsgId and its mentions of members only', async () => {
    const { tenant, officeId, join } = await company('chat-a')
    const ann = await join('Ann')
    const bob = await join('Bob')
    const outsider = await (await company('chat-b')).join('Eve')
    const clientMsgId = randomUUID()
    const input = { officeId, authorId: ann, clientMsgId, body: `hi <@${bob}>`, mentionsEveryone: false, mentionUserIds: [bob, outsider, ann] }

    const first = await tenant.insertChatMessage(input)
    expect(first).toMatchObject({ created: true, message: { body: `hi <@${bob}>`, authorId: ann, author: { name: 'Ann' }, deletedAt: null } })
    const again = await tenant.insertChatMessage({ ...input, body: 'changed' })
    expect(again).toMatchObject({ created: false, message: { id: first?.message.id, body: `hi <@${bob}>` } })
    expect((await tenant.countUnread(officeId, bob, { blockedUserIds: [], limit: 100 })).mentions).toBe(1)
    expect((await tenant.countUnread(officeId, outsider, { blockedUserIds: [], limit: 100 })).mentions).toBe(0)

    const other = await company('chat-c')
    expect(await other.tenant.getChatMessage(officeId, first?.message.id ?? '')).toBeNull()
    expect(await other.tenant.insertChatMessage({ ...input, officeId: other.officeId })).toBeNull()
  })

  it('pages back newest first and keeps a guest to the messages since they joined', async () => {
    const { tenant, officeId, join } = await company('chat-d')
    const ann = await join('Ann')
    const start = Date.now() - 60_000
    for (let i = 0; i < 7; i++) {
      await tenant.insertChatMessage({
        officeId,
        authorId: ann,
        clientMsgId: randomUUID(),
        body: `m${i}`,
        mentionsEveryone: false,
        mentionUserIds: [],
        createdAt: new Date(start + i * 1000),
      })
    }
    const page1 = await tenant.listChatMessages(officeId, { limit: 3 })
    expect(page1.map((m) => m.body)).toEqual(['m6', 'm5', 'm4'])
    const page2 = await tenant.listChatMessages(officeId, { limit: 3, before: page1.at(-1)?.id })
    expect(page2.map((m) => m.body)).toEqual(['m3', 'm2', 'm1'])
    const page3 = await tenant.listChatMessages(officeId, { limit: 3, before: page2.at(-1)?.id })
    expect(page3.map((m) => m.body)).toEqual(['m0'])

    const since = new Date(start + 4000)
    expect((await tenant.listChatMessages(officeId, { limit: 50, since })).map((m) => m.body)).toEqual(['m6', 'm5', 'm4'])
    const guest = await join('Gus', 'guest', since)
    expect(await tenant.findMember(guest)).toEqual({ role: 'guest', joinedAt: since })
    expect((await tenant.countUnread(officeId, guest, { since, blockedUserIds: [], limit: 100 })).count).toBe(3)
  })

  it('soft deletes into a tombstone and removes its mentions', async () => {
    const { tenant, officeId, join } = await company('chat-e')
    const ann = await join('Ann')
    const bob = await join('Bob')
    const sent = await tenant.insertChatMessage({ officeId, authorId: ann, clientMsgId: randomUUID(), body: `<@${bob}>`, mentionsEveryone: false, mentionUserIds: [bob] })
    const id = sent?.message.id ?? ''
    expect(await (await company('chat-f')).tenant.deleteChatMessage(officeId, id, ann)).toBe(false)
    expect(await tenant.deleteChatMessage(officeId, id, bob)).toBe(true)
    expect(await tenant.deleteChatMessage(officeId, id, bob)).toBe(false)
    expect(await tenant.getChatMessage(officeId, id)).toMatchObject({ body: '', deletedBy: bob, deletedAt: expect.any(Date) })
    expect(await tenant.countUnread(officeId, bob, { blockedUserIds: [], limit: 100 })).toEqual({ count: 0, mentions: 0, lastReadId: null })
  })

  it('counts unread messages after the read state, which only moves forward', async () => {
    const { tenant, officeId, join } = await company('chat-g')
    const ann = await join('Ann')
    const bob = await join('Bob')
    const cy = await join('Cy')
    const send = async (authorId: string, everyone = false) =>
      (await tenant.insertChatMessage({ officeId, authorId, clientMsgId: randomUUID(), body: 'x', mentionsEveryone: everyone, mentionUserIds: [] }))?.message.id ?? ''
    const first = await send(ann)
    await send(bob)
    const third = await send(ann, true)
    await send(cy)

    expect(await tenant.countUnread(officeId, bob, { blockedUserIds: [], limit: 100 })).toEqual({ count: 3, mentions: 1, lastReadId: null })
    expect(await tenant.countUnread(officeId, bob, { blockedUserIds: [cy], limit: 2 })).toEqual({ count: 2, mentions: 1, lastReadId: null })
    expect(await tenant.markChatRead(officeId, bob, third)).toBe(true)
    expect(await tenant.markChatRead(officeId, bob, first)).toBe(true)
    expect(await tenant.markChatRead(officeId, bob, randomUUID())).toBe(false)
    expect(await tenant.countUnread(officeId, bob, { blockedUserIds: [], limit: 100 })).toEqual({ count: 1, mentions: 0, lastReadId: third })
  })
})

describe('prefs, blocks, mutes and members', () => {
  it('saves only the named fields and adds or removes blocks one at a time', async () => {
    const { tenant, join } = await company('prefs-a')
    const ann = await join('Ann')
    const bob = await join('Bob')
    expect(await tenant.getPrefs(ann)).toBeNull()
    expect(await tenant.savePrefs(ann, { statusText: 'Focus', notifyMentions: undefined })).toMatchObject({
      statusText: 'Focus',
      blockedUserIds: [],
      notifyMentions: true,
    })
    await tenant.setBlocked(ann, bob, true)
    expect((await tenant.setBlocked(ann, bob, true)).blockedUserIds).toEqual([bob])
    expect(await tenant.blockersOf(bob, [ann, bob])).toEqual([ann])
    expect(await (await company('prefs-b')).tenant.blockersOf(bob, [ann])).toEqual([])
    expect((await tenant.setBlocked(ann, bob, false)).blockedUserIds).toEqual([])
    expect((await tenant.savePrefs(ann, { notifyMentions: false })).statusText).toBe('Focus')
  })

  it('mutes until a time and unmutes', async () => {
    const { tenant, join } = await company('mute-a')
    const ann = await join('Ann', 'admin')
    const bob = await join('Bob')
    const until = new Date(Date.now() + 60_000)
    await tenant.setMute(bob, until, ann)
    expect(await tenant.mutedUntil(bob)).toEqual(until)
    expect(await tenant.mutedUntil(bob, new Date(until.getTime() + 1))).toBeNull()
    expect(await (await company('mute-b')).tenant.mutedUntil(bob)).toBeNull()
    await tenant.setMute(bob, null, ann)
    expect(await tenant.mutedUntil(bob)).toBeNull()
  })

  it('lists the members of the company only', async () => {
    const { tenant, join } = await company('members-a', new Date(Date.now() - 1000))
    const ann = await join('Ann', 'owner')
    const gus = await join('Gus', 'guest', new Date())
    await (await company('members-b')).join('Eve')
    expect((await tenant.listMembers()).map((m) => [m.userId, m.name, m.role])).toEqual([
      [ann, 'Ann', 'owner'],
      [gus, 'Gus', 'guest'],
    ])
    expect(await tenant.membersAmong([ann, 'nobody'])).toEqual([ann])
  })
})
