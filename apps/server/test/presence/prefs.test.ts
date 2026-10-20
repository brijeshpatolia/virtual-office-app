import { forOrg } from '@vo/db'
import { MAX_BLOCKED_USERS } from '@vo/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { defaultPrefs } from '../../src/presence/prefs.ts'
import { startChatDb, type ChatTestDb } from '../chat/fixtures.ts'

let t: ChatTestDb
let companies = 0

beforeAll(async () => {
  t = await startChatDb()
})
afterAll(() => t.close())

const prefs = () => t.services.prefs

async function people() {
  const company = await t.company(`Prefs${++companies}`)
  const [ann, bob, cy] = await Promise.all([company.join('Ann'), company.join('Bob'), company.join('Cy')])
  return { orgId: company.orgId, ann, bob, cy }
}

describe('prefs', () => {
  it('starts from the defaults and changes only the named fields, per company', async () => {
    const { orgId, ann, bob } = await people()
    expect(await prefs().get(orgId, ann.userId)).toEqual(defaultPrefs())
    expect(await prefs().update(orgId, ann.userId, { statusText: '  Focus time  ' })).toEqual({
      ok: true,
      prefs: { statusText: 'Focus time', blockedUserIds: [], notifyMentions: true },
    })
    expect(await prefs().update(orgId, ann.userId, { notifyMentions: false, blockedUserIds: [bob.userId, bob.userId] })).toEqual({
      ok: true,
      prefs: { statusText: 'Focus time', blockedUserIds: [bob.userId], notifyMentions: false },
    })
    const other = await t.company('PrefsOther')
    expect(await prefs().get(other.orgId, ann.userId)).toEqual(defaultPrefs())
  })

  it('refuses a bad status text and blocks of yourself or of people outside the company', async () => {
    const { orgId, ann, bob } = await people()
    const outsider = await (await t.company('PrefsOutside')).join('Eve')
    const invalid = { ok: false, reason: 'invalid' }
    expect(await prefs().update(orgId, ann.userId, { statusText: 'x'.repeat(81) })).toEqual(invalid)
    expect(await prefs().update(orgId, ann.userId, { statusText: 'two\nlines' })).toEqual(invalid)
    expect(await prefs().update(orgId, ann.userId, { blockedUserIds: [ann.userId] })).toEqual(invalid)
    expect(await prefs().update(orgId, ann.userId, { blockedUserIds: [bob.userId, outsider.userId] })).toEqual(invalid)
    expect(await prefs().update(orgId, ann.userId, { notifyMentions: 'yes' } as never)).toEqual(invalid)
    expect(await prefs().get(orgId, ann.userId)).toEqual(defaultPrefs())
  })

  it('blocks and unblocks one person at a time', async () => {
    const { orgId, ann, bob, cy } = await people()
    expect(await prefs().setBlocked(orgId, ann.userId, ann.userId, true)).toEqual({ ok: false, reason: 'invalid' })
    expect(await prefs().setBlocked(orgId, ann.userId, 'nobody', true)).toEqual({ ok: false, reason: 'not_found' })
    expect(await prefs().setBlocked(orgId, ann.userId, bob.userId, true)).toMatchObject({ ok: true, prefs: { blockedUserIds: [bob.userId] } })
    expect(await prefs().setBlocked(orgId, ann.userId, bob.userId, true)).toMatchObject({ ok: true, prefs: { blockedUserIds: [bob.userId] } })
    // Unblocking always works, also for an id that is not a member.
    expect(await prefs().setBlocked(orgId, ann.userId, 'nobody', false)).toMatchObject({ ok: true })
    expect(await prefs().blockedBetween(orgId, ann.userId, [bob.userId, cy.userId, ann.userId])).toEqual(new Set([bob.userId]))
    expect(await prefs().blockedBetween(orgId, bob.userId, [ann.userId, cy.userId])).toEqual(new Set([ann.userId]))
    expect(await prefs().blockedBetween(orgId, cy.userId, [ann.userId, bob.userId])).toEqual(new Set())
    expect(await prefs().setBlocked(orgId, ann.userId, bob.userId, false)).toMatchObject({ ok: true, prefs: { blockedUserIds: [] } })
    expect(await prefs().blockedBetween(orgId, bob.userId, [ann.userId])).toEqual(new Set())
  })

  it(`keeps the block list at ${MAX_BLOCKED_USERS} people`, async () => {
    const { orgId, ann, bob } = await people()
    const full = Array.from({ length: MAX_BLOCKED_USERS }, (_, i) => `former-${i}`)
    await forOrg(t.handle.db, orgId).savePrefs(ann.userId, { blockedUserIds: full })
    expect(await prefs().setBlocked(orgId, ann.userId, bob.userId, true)).toEqual({ ok: false, reason: 'invalid' })
    // Ids already on the list may stay, also when they are no longer members.
    expect(await prefs().update(orgId, ann.userId, { blockedUserIds: full.slice(1) })).toMatchObject({ ok: true })
    expect(await prefs().setBlocked(orgId, ann.userId, bob.userId, true)).toMatchObject({ ok: true })
  })

  it('tells the listeners of each change, with its origin', async () => {
    const { orgId, ann, bob } = await people()
    const heard: unknown[] = []
    const stop = prefs().onChange((org, userId, changed, origin) => heard.push([org === orgId, userId, changed.statusText, origin]))
    const origin = { room: 1 }
    await prefs().update(orgId, ann.userId, { statusText: 'Away' }, origin)
    await prefs().setBlocked(orgId, ann.userId, bob.userId, true)
    await prefs().update(orgId, ann.userId, { statusText: 'x'.repeat(81) })
    stop()
    await prefs().update(orgId, ann.userId, { statusText: 'Back' })
    expect(heard).toEqual([
      [true, ann.userId, 'Away', origin],
      [true, ann.userId, 'Away', undefined],
    ])
  })
})
