import { describe, expect, it } from 'vitest'
import { EVERYONE_TOKEN, mentionToken, UNREAD_COUNT_LIMIT, unreadBadge } from '@vo/shared'
import { idOf, message } from './testMessages.ts'
import { addUnread, countsAsUnread, isReading, mentionsUser, NO_UNREAD, readTarget, removeUnread, shouldNotify, type NotifyInput } from './unread.ts'

const viewer = { userId: 'me', blocked: new Set(['troll']) }

describe('unread counts', () => {
  it('counts messages from others that are not deleted and not from blocked people', () => {
    expect(countsAsUnread(message(1), viewer)).toBe(true)
    expect(countsAsUnread(message(1, { authorId: 'me' }), viewer)).toBe(false)
    expect(countsAsUnread(message(1, { authorId: 'troll' }), viewer)).toBe(false)
    expect(countsAsUnread(message(1, { deletedAt: '2026-10-20T10:00:00.000Z' }), viewer)).toBe(false)
  })

  it('counts mentions of the viewer and of everyone, and stops at the server limit', () => {
    let counts = addUnread(NO_UNREAD, message(1, { body: `${mentionToken('me')} hi` }), viewer)
    counts = addUnread(counts, message(2, { body: `${EVERYONE_TOKEN} lunch` }), viewer)
    counts = addUnread(counts, message(3, { body: `${mentionToken('someone')} hi` }), viewer)
    expect(counts).toEqual({ count: 3, mentions: 2 })
    expect(mentionsUser('@me typed by hand', 'me')).toBe(false)
    let many = NO_UNREAD
    for (let i = 0; i < 150; i++) many = addUnread(many, message(i), viewer)
    expect(many.count).toBe(UNREAD_COUNT_LIMIT)
    expect(unreadBadge(many.count)).toBe('99+')
    expect(unreadBadge(99)).toBe('99')
  })

  it('takes a deleted unread message off again, but not one already read', () => {
    const mention = message(5, { body: `${mentionToken('me')} hi` })
    const counts = { count: 2, mentions: 1 }
    expect(removeUnread(counts, mention, viewer, idOf(4))).toEqual({ count: 1, mentions: 0 })
    expect(removeUnread(counts, mention, viewer, idOf(5))).toBe(counts)
    expect(removeUnread(NO_UNREAD, message(9), viewer, null)).toEqual(NO_UNREAD)
  })
})

describe('read state', () => {
  it('reads only with the bar open, scrolled to the bottom and the tab visible', () => {
    expect(isReading({ expanded: true, atBottom: true, visible: true })).toBe(true)
    expect(isReading({ expanded: false, atBottom: true, visible: true })).toBe(false)
    expect(isReading({ expanded: true, atBottom: false, visible: true })).toBe(false)
    expect(isReading({ expanded: true, atBottom: true, visible: false })).toBe(false)
  })

  it('sends the newest id only when it moves the read state forward', () => {
    const list = [message(1), message(2)]
    expect(readTarget(list, null)).toBe(idOf(2))
    expect(readTarget(list, idOf(1))).toBe(idOf(2))
    expect(readTarget(list, idOf(2))).toBeNull()
    expect(readTarget([], null)).toBeNull()
  })
})

describe('shouldNotify', () => {
  const base: NotifyInput = {
    message: message(1, { body: `${mentionToken('me')} got a minute?` }),
    viewer,
    chosenStatus: 'available',
    notifyMentions: true,
    hidden: true,
    permission: 'granted',
  }

  it('notifies a mention while the tab is hidden', () => {
    expect(shouldNotify(base)).toBe(true)
    expect(shouldNotify({ ...base, message: message(1, { body: `${EVERYONE_TOKEN} standup` }) })).toBe(true)
  })

  it('stays quiet on DND, when turned off, without permission, with the tab visible, for blocked authors and plain messages', () => {
    expect(shouldNotify({ ...base, chosenStatus: 'dnd' })).toBe(false)
    expect(shouldNotify({ ...base, notifyMentions: false })).toBe(false)
    expect(shouldNotify({ ...base, permission: 'default' })).toBe(false)
    expect(shouldNotify({ ...base, permission: 'unsupported' })).toBe(false)
    expect(shouldNotify({ ...base, hidden: false })).toBe(false)
    expect(shouldNotify({ ...base, message: { ...base.message, authorId: 'troll' } })).toBe(false)
    expect(shouldNotify({ ...base, message: { ...base.message, authorId: 'me' } })).toBe(false)
    expect(shouldNotify({ ...base, message: message(1) })).toBe(false)
  })
})
