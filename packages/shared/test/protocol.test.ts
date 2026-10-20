import { describe, expect, it } from 'vitest'
import {
  API,
  AVATAR_COLORS,
  avatarColor,
  CreateInviteLinkRequestSchema,
  JoinOptionsSchema,
  MeResponseSchema,
  MoveMessageSchema,
  MoveRejectSchema,
  rejectReason,
  SitResponseSchema,
} from '../src/index.ts'

describe('realtime protocol', () => {
  it('accepts a valid move and rejects bad numbers and extra precision on seq', () => {
    expect(MoveMessageSchema.parse({ x: 10.5, y: 20, dir: 'left', moving: true, seq: 3 })).toEqual({
      x: 10.5,
      y: 20,
      dir: 'left',
      moving: true,
      seq: 3,
    })
    expect(MoveMessageSchema.safeParse({ x: Number.NaN, y: 0, dir: 'up', moving: false, seq: 0 }).success).toBe(false)
    expect(MoveMessageSchema.safeParse({ x: Infinity, y: 0, dir: 'up', moving: false, seq: 0 }).success).toBe(false)
    expect(MoveMessageSchema.safeParse({ x: 0, y: 0, dir: 'north', moving: false, seq: 0 }).success).toBe(false)
    expect(MoveMessageSchema.safeParse({ x: 0, y: 0, dir: 'up', moving: false, seq: 1.5 }).success).toBe(false)
  })

  it('checks join options, sit responses and move rejects', () => {
    expect(JoinOptionsSchema.safeParse({ officeId: '' }).success).toBe(false)
    expect(SitResponseSchema.parse({ ok: true, seatId: 'd1', x: 1, y: 2, dir: 'down' }).seatId).toBe('d1')
    expect(MoveRejectSchema.safeParse({ x: 0, y: 0, seq: 1, reason: 'teleport' }).success).toBe(false)
  })

  it('reads the reason of a rejected room request', () => {
    const rejected = Object.assign(new Error('request rejected'), { name: 'rejected', reason: 'taken' })
    expect(rejectReason(rejected)).toBe('taken')
    expect(rejectReason(new Error('timeout'))).toBeNull()
    expect(rejectReason('taken')).toBeNull()
  })

  it('gives each user one stable avatar colour from the palette', () => {
    expect(avatarColor('user-1')).toBe(avatarColor('user-1'))
    expect(AVATAR_COLORS).toContain(avatarColor('user-2'))
    expect(new Set(['a', 'b', 'c', 'd', 'e', 'f'].map(avatarColor)).size).toBeGreaterThan(1)
  })
})

describe('http protocol', () => {
  it('builds encoded API paths', () => {
    expect(API.rtToken('a b')).toBe('/api/rt-token?officeId=a%20b')
    expect(API.inviteLinks('o1')).toBe('/api/offices/o1/invite-links')
  })

  it('validates request and response bodies', () => {
    expect(CreateInviteLinkRequestSchema.safeParse({ role: 'owner' }).success).toBe(false)
    expect(CreateInviteLinkRequestSchema.parse({ role: 'guest', maxUses: 5 })).toEqual({ role: 'guest', maxUses: 5 })
    const me = { user: { id: 'u', name: '', email: 'a@b.c', image: null }, orgs: [], offices: [] }
    expect(MeResponseSchema.parse(me)).toEqual(me)
  })
})
