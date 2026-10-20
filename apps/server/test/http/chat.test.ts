import { forOrg } from '@vo/db'
import { CHAT_PAGE_SIZE, type ChatHistoryResponse, type MembersResponse, type UserPrefsResponse } from '@vo/shared'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createCompany, createInviteLink, newUser, startTestApi, type TestApi, type TestClient } from './helpers.ts'

// The P2 routes: chat history and unread counts, the member list and the prefs.
let api: TestApi
let owner: TestClient
let company: { orgId: string; officeId: string }
let users = 0

beforeAll(async () => {
  api = await startTestApi()
  owner = await newUser(api, 'olga@chat.example', 'Olga')
  company = await createCompany(owner, 'Chatty', 'Chatty HQ')
})
afterAll(async () => {
  await api?.close()
})

const history = (client: TestClient, query = '', officeId = company.officeId) =>
  client.call<ChatHistoryResponse>(`/api/offices/${officeId}/chat${query}`)
const unread = (client: TestClient, officeId = company.officeId) => client.call(`/api/offices/${officeId}/chat/unread`)
const members = (client: TestClient, officeId = company.officeId) => client.call<MembersResponse>(`/api/offices/${officeId}/members`)
const prefsPath = (orgId = company.orgId) => `/api/me/prefs?orgId=${orgId}`
const scope = () => ({ orgId: company.orgId, officeId: company.officeId })

async function join(role: 'member' | 'guest', name: string): Promise<TestClient> {
  const link = await createInviteLink(owner, company.officeId, { role })
  const client = await newUser(api, `user${++users}@chat.example`, name)
  expect((await client.post(`/api/invite-links/${link.token}/accept`)).status).toBe(200)
  return client
}

async function seed(authorId: string, count: number, createdAt: Date): Promise<string[]> {
  const tenant = forOrg(api.database.db, company.orgId)
  const ids: string[] = []
  for (let i = 0; i < count; i++) {
    const stored = await tenant.insertChatMessage({
      officeId: company.officeId,
      authorId,
      clientMsgId: randomUUID(),
      body: `old ${i}`,
      mentionsEveryone: false,
      mentionUserIds: [],
      createdAt,
    })
    ids.push(stored?.message.id ?? '')
  }
  return ids
}

describe('GET /api/offices/:officeId/chat', () => {
  it('pages the history back, newest first, for members', async () => {
    const mia = await join('member', 'Mia')
    const ids = await seed(owner.userId, 60, new Date(Date.now() - 3_600_000))
    const first = await history(mia)
    expect(first.status).toBe(200)
    expect(first.headers.get('cache-control')).toBe('no-store')
    expect(first.body.messages).toHaveLength(CHAT_PAGE_SIZE)
    expect(first.body.messages[0]).toMatchObject({ id: ids.at(-1), authorId: owner.userId, authorName: 'Olga', body: 'old 59', deletedAt: null })
    const second = await history(mia, `?before=${first.body.nextBefore}`)
    expect(second.body.nextBefore).toBeNull()
    expect([...first.body.messages, ...second.body.messages].map((m) => m.id)).toEqual([...ids].reverse())
    expect((await history(mia, `?limit=5&before=${ids[3]}`)).body.messages.map((m) => m.body)).toEqual(['old 2', 'old 1', 'old 0'])

    for (const query of ['?limit=0', '?limit=51', '?limit=x', '?before=nope', '?limit=5&limit=6', '?before=']) {
      expect((await history(mia, query)).status, query).toBe(400)
    }
  })

  it('shows a guest only the messages since they joined, in history and unread', async () => {
    await seed(owner.userId, 3, new Date(Date.now() - 60_000))
    const gus = await join('guest', 'Gus')
    const sent = await api.services.chat.send(scope(), { userId: owner.userId, role: 'owner', name: 'Olga' }, { clientMsgId: randomUUID(), body: 'welcome <!everyone>' })
    expect(sent.ok).toBe(true)
    const page = await history(gus)
    expect(page.status).toBe(200)
    expect(page.body.messages.map((m) => m.body)).toEqual(['welcome <!everyone>'])
    expect(page.body.nextBefore).toBeNull()
    expect(await unread(gus)).toMatchObject({ status: 200, body: { count: 1, mentions: 1, lastReadId: null } })
    expect((await history(owner)).body.messages.length).toBeGreaterThan(1)
  })

  it('answers 404 to another company, and 401 without a session', async () => {
    const rival = await newUser(api, `user${++users}@rival.example`, 'Rex')
    const rivalCompany = await createCompany(rival, 'Rival')
    for (const result of [await history(rival), await unread(rival), await members(rival), await rival.call(prefsPath())]) {
      expect(result).toMatchObject({ status: 404, body: { error: 'not_found' } })
    }
    expect((await history(owner, '', rivalCompany.officeId)).status).toBe(404)
    expect((await history(owner, '', 'no-such-office')).status).toBe(404)
    const anonymous = api.client()
    expect((await history(anonymous)).status).toBe(401)
    expect((await anonymous.call(prefsPath())).status).toBe(401)
  })

  it('shuts out a removed member at once', async () => {
    const ray = await join('member', 'Ray')
    expect((await history(ray)).status).toBe(200)
    const removed = await owner.post('/api/auth/organization/remove-member', { memberIdOrEmail: ray.user?.email, organizationId: company.orgId })
    expect(removed.status).toBe(200)
    expect((await history(ray)).status).toBe(404)
    const sent = await api.services.chat.send(scope(), { userId: ray.userId, role: 'member', name: 'Ray' }, { clientMsgId: randomUUID(), body: 'still here?' })
    expect(sent).toEqual({ ok: false, reason: 'invalid' })
  })
})

describe('GET /api/offices/:officeId/members', () => {
  it('lists the members, oldest first, to everyone but guests', async () => {
    const mo = await join('member', 'Mo')
    const gil = await join('guest', 'Gil')
    const listed = await members(mo)
    expect(listed.status).toBe(200)
    const rows = listed.body.members
    expect(rows[0]).toMatchObject({ userId: owner.userId, name: 'Olga', role: 'owner' })
    expect(rows.find((m) => m.userId === gil.userId)).toMatchObject({ name: 'Gil', role: 'guest' })
    expect(rows.map((m) => m.joinedAt)).toEqual([...rows.map((m) => m.joinedAt)].sort())
    expect(JSON.stringify(listed.body)).not.toContain('@')
    expect(await members(gil)).toMatchObject({ status: 403, body: { error: 'forbidden' } })
  })
})

describe('/api/me/prefs', () => {
  it('reads and changes the prefs of one company', async () => {
    const pia = await join('member', 'Pia')
    const kai = await join('guest', 'Kai')
    expect(await pia.call(prefsPath())).toMatchObject({
      status: 200,
      body: { orgId: company.orgId, statusText: '', blockedUserIds: [], notifyMentions: true } satisfies UserPrefsResponse,
    })
    const put = (client: TestClient, body: unknown, options: { origin?: string | null } = {}) =>
      client.call<UserPrefsResponse>(prefsPath(), { method: 'PUT', body, ...options })
    expect(await put(pia, { statusText: '  Deep work  ', blockedUserIds: [kai.userId], notifyMentions: false })).toMatchObject({
      status: 200,
      body: { orgId: company.orgId, statusText: 'Deep work', blockedUserIds: [kai.userId], notifyMentions: false },
    })
    expect(await put(pia, { notifyMentions: true })).toMatchObject({ status: 200, body: { statusText: 'Deep work', notifyMentions: true } })
    // A guest has prefs too.
    expect((await put(kai, { statusText: 'Visiting' })).status).toBe(200)

    const outsider = await newUser(api, `user${++users}@else.example`)
    for (const body of [
      { blockedUserIds: [pia.userId] },
      { blockedUserIds: [outsider.userId] },
      { statusText: 'x'.repeat(81) },
      { statusText: 'a\u0007b' },
      { notifyMentions: 'no' },
      { blockedUserIds: 'all' },
    ]) {
      expect((await put(pia, body)).status, JSON.stringify(body)).toBe(400)
    }
    expect((await put(pia, { statusText: 'sneaky' }, { origin: null })).status).toBe(403)
    expect((await pia.call('/api/me/prefs')).status).toBe(400)
    expect((await pia.call('/api/me/prefs?orgId=no-such-company')).status).toBe(404)
    expect((await pia.call(prefsPath())).body).toMatchObject({ statusText: 'Deep work', blockedUserIds: [kai.userId] })
  })
})
