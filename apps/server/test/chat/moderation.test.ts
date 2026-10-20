import { auditLog } from '@vo/db'
import { MUTE_MAX_MINUTES } from '@vo/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MUTE_CACHE_MS, canModerate } from '../../src/chat/moderation.ts'
import { startChatDb, type ChatTestDb } from './fixtures.ts'

let t: ChatTestDb
let companies = 0

beforeAll(async () => {
  t = await startChatDb()
})
afterAll(() => t.close())

async function staff() {
  const company = await t.company(`Mod${++companies}`)
  const [olga, ada, adam, bob, gus] = await Promise.all([
    company.join('Olga', 'owner'),
    company.join('Ada', 'admin'),
    company.join('Adam', 'admin'),
    company.join('Bob'),
    company.join('Gus', 'guest'),
  ])
  return { company, olga, ada, adam, bob, gus }
}

const moderation = () => t.services.moderation

describe('canModerate', () => {
  it('lets owners and admins act on lower roles only, never on themselves', () => {
    expect(canModerate({ userId: 'a', role: 'admin' }, { userId: 'b', role: 'member' })).toBe(true)
    expect(canModerate({ userId: 'a', role: 'admin' }, { userId: 'b', role: 'guest' })).toBe(true)
    expect(canModerate({ userId: 'a', role: 'owner' }, { userId: 'b', role: 'admin' })).toBe(true)
    expect(canModerate({ userId: 'a', role: 'admin' }, { userId: 'b', role: 'admin' })).toBe(false)
    expect(canModerate({ userId: 'a', role: 'admin' }, { userId: 'b', role: 'owner' })).toBe(false)
    expect(canModerate({ userId: 'a', role: 'member' }, { userId: 'b', role: 'guest' })).toBe(false)
    expect(canModerate({ userId: 'a', role: 'owner' }, { userId: 'a', role: 'owner' })).toBe(false)
  })
})

describe('mute', () => {
  it('mutes and unmutes lower roles, with the roles read from the database', async () => {
    const { company, olga, ada, adam, bob, gus } = await staff()
    const outsider = await (await t.company('Outside')).join('Eve')
    const { orgId } = company
    // A member who claims to be an owner is still a member.
    expect(await moderation().mute(orgId, { userId: bob.userId, role: 'owner' }, gus.userId, 15)).toEqual({ ok: false, reason: 'not_allowed' })
    expect(await moderation().mute(orgId, bob, outsider.userId, 15)).toEqual({ ok: false, reason: 'not_allowed' })
    expect(await moderation().mute(orgId, ada, olga.userId, 15)).toEqual({ ok: false, reason: 'not_allowed' })
    expect(await moderation().mute(orgId, ada, adam.userId, 15)).toEqual({ ok: false, reason: 'not_allowed' })
    expect(await moderation().mute(orgId, ada, ada.userId, 15)).toEqual({ ok: false, reason: 'not_allowed' })
    expect(await moderation().mute(orgId, ada, outsider.userId, 15)).toEqual({ ok: false, reason: 'not_found' })
    expect(await moderation().mute(orgId, ada, bob.userId, MUTE_MAX_MINUTES + 1)).toEqual({ ok: false, reason: 'invalid' })
    expect(await moderation().mute(orgId, ada, bob.userId, 1.5)).toEqual({ ok: false, reason: 'invalid' })

    expect(await moderation().mutedUntil(orgId, bob.userId)).toBeNull()
    const until = new Date(t.clock.ms + 15 * 60_000)
    expect(await moderation().mute(orgId, ada, bob.userId, 15)).toEqual({ ok: true, until })
    // The cached "not muted" answer was replaced at once.
    expect(await moderation().mutedUntil(orgId, bob.userId)).toEqual(until)
    expect(await moderation().mutedUntil(`${orgId}-other`, bob.userId)).toBeNull()
    expect((await moderation().mute(orgId, olga, ada.userId, MUTE_MAX_MINUTES)).ok).toBe(true)
    expect(await moderation().mute(orgId, ada, gus.userId, 60)).toMatchObject({ ok: true })
    expect(await moderation().mute(orgId, ada, bob.userId, 0)).toEqual({ ok: true, until: null })
    expect(await moderation().mutedUntil(orgId, bob.userId)).toBeNull()

    const entries = (await t.handle.db.select().from(auditLog)).filter((e) => e.orgId === orgId)
    expect(entries.map((e) => [e.action, e.actorId, e.targetId])).toEqual([
      ['chat.mute', ada.userId, bob.userId],
      ['chat.mute', olga.userId, ada.userId],
      ['chat.mute', ada.userId, gus.userId],
      ['chat.unmute', ada.userId, bob.userId],
    ])
    expect(entries[0]?.data).toEqual({ minutes: 15, until: until.toISOString() })
  })

  it('ends a mute at its time, also from the cache', async () => {
    const { company, ada, bob } = await staff()
    await moderation().mute(company.orgId, ada, bob.userId, 1)
    expect(await moderation().mutedUntil(company.orgId, bob.userId)).not.toBeNull()
    t.clock.advance(60_000)
    expect(await moderation().mutedUntil(company.orgId, bob.userId)).toBeNull()
    t.clock.advance(MUTE_CACHE_MS)
    expect(await moderation().mutedUntil(company.orgId, bob.userId)).toBeNull()
  })
})

describe('kick', () => {
  it('lets owners and admins kick lower roles only, and records each kick', async () => {
    const { company, olga, ada, bob, gus } = await staff()
    const { orgId } = company
    expect(await moderation().authorizeKick(orgId, bob, gus.userId)).toEqual({ ok: false, reason: 'not_allowed' })
    expect(await moderation().authorizeKick(orgId, ada, olga.userId)).toEqual({ ok: false, reason: 'not_allowed' })
    expect(await moderation().authorizeKick(orgId, ada, 'nobody')).toEqual({ ok: false, reason: 'not_found' })
    expect(await moderation().authorizeKick(orgId, ada, bob.userId)).toEqual({ ok: true })
    expect(await moderation().authorizeKick(orgId, olga, ada.userId)).toEqual({ ok: true })
    await moderation().recordKick(orgId, ada, bob.userId, company.officeId)
    const entries = (await t.handle.db.select().from(auditLog)).filter((e) => e.orgId === orgId)
    expect(entries.map((e) => [e.action, e.actorId, e.targetId, e.data])).toEqual([['office.kick', ada.userId, bob.userId, { officeId: company.officeId }]])
  })
})
