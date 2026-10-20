import { describe, expect, it } from 'vitest'
import {
  AdminMuteRequestSchema,
  API,
  ChatHistoryQuerySchema,
  ChatSendRequestSchema,
  effectiveStatus,
  MUTE_MAX_MINUTES,
  StatusSetRequestSchema,
  unreadBadge,
  UpdatePrefsRequestSchema,
} from '../src/index.ts'

const uuid = '0192f5e4-1b2c-7abc-8def-0123456789ab'

describe('effectiveStatus', () => {
  it('lets DND win, then away, then busy (chosen or in a room-mode zone)', () => {
    expect(effectiveStatus({ chosen: 'dnd', away: true, inRoomZone: true })).toBe('dnd')
    expect(effectiveStatus({ chosen: 'busy', away: true, inRoomZone: false })).toBe('away')
    expect(effectiveStatus({ chosen: 'available', away: false, inRoomZone: true })).toBe('busy')
    expect(effectiveStatus({ chosen: 'busy', away: false, inRoomZone: false })).toBe('busy')
    expect(effectiveStatus({ chosen: 'available', away: false, inRoomZone: false })).toBe('available')
  })
})

describe('chat and presence messages', () => {
  it('needs a uuid clientMsgId', () => {
    expect(ChatSendRequestSchema.safeParse({ clientMsgId: uuid, body: 'hi' }).success).toBe(true)
    expect(ChatSendRequestSchema.safeParse({ clientMsgId: 'abc', body: 'hi' }).success).toBe(false)
  })

  it('checks status, status text and mute minutes', () => {
    expect(StatusSetRequestSchema.parse({ status: 'dnd', statusText: '  focus  ' })).toEqual({ status: 'dnd', statusText: 'focus' })
    expect(StatusSetRequestSchema.safeParse({ status: 'away' }).success).toBe(false)
    expect(StatusSetRequestSchema.safeParse({ status: 'busy', statusText: 'x'.repeat(81) }).success).toBe(false)
    expect(StatusSetRequestSchema.safeParse({ status: 'busy', statusText: 'a\nb' }).success).toBe(false)
    expect(AdminMuteRequestSchema.safeParse({ userId: 'u', minutes: MUTE_MAX_MINUTES }).success).toBe(true)
    expect(AdminMuteRequestSchema.safeParse({ userId: 'u', minutes: MUTE_MAX_MINUTES + 1 }).success).toBe(false)
    expect(AdminMuteRequestSchema.safeParse({ userId: 'u', minutes: 1.5 }).success).toBe(false)
  })

  it('caps the unread badge at 99+', () => {
    expect(unreadBadge(0)).toBe('0')
    expect(unreadBadge(99)).toBe('99')
    expect(unreadBadge(100)).toBe('99+')
  })
})

describe('chat and prefs routes', () => {
  it('builds the paths', () => {
    expect(API.chat('o 1')).toBe('/api/offices/o%201/chat')
    expect(API.chat('o1', { before: uuid, limit: 10 })).toBe(`/api/offices/o1/chat?before=${uuid}&limit=10`)
    expect(API.chatUnread('o1')).toBe('/api/offices/o1/chat/unread')
    expect(API.members('o1')).toBe('/api/offices/o1/members')
    expect(API.prefs('org 1')).toBe('/api/me/prefs?orgId=org%201')
  })

  it('reads the history query from strings', () => {
    expect(ChatHistoryQuerySchema.parse({})).toEqual({ limit: 50 })
    expect(ChatHistoryQuerySchema.parse({ before: uuid, limit: '20' })).toEqual({ before: uuid, limit: 20 })
    for (const query of [{ limit: '0' }, { limit: '51' }, { limit: ['1', '2'] }, { before: 'x' }]) {
      expect(ChatHistoryQuerySchema.safeParse(query).success).toBe(false)
    }
  })

  it('accepts partial prefs updates only', () => {
    expect(UpdatePrefsRequestSchema.parse({ notifyMentions: false })).toEqual({ notifyMentions: false })
    expect(UpdatePrefsRequestSchema.safeParse({ blockedUserIds: Array.from({ length: 501 }, (_, i) => `u${i}`) }).success).toBe(false)
  })
})
