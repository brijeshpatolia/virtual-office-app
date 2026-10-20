import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@vo/shared'
import { blockedRowText, chatRows, compareIds, EMPTY_HISTORY, mergeMessages, withDeleted, withNewestPage, withOlderPage } from './messages.ts'
import { idOf, message, numberOf } from './testMessages.ts'

const ids = (messages: readonly ChatMessage[]): number[] => messages.map((m) => numberOf(m.id))
// A page as the server sends it: newest first.
const page = (from: number, to: number, nextBefore: number | null) => ({
  messages: Array.from({ length: to - from + 1 }, (_, i) => message(to - i)),
  nextBefore: nextBefore === null ? null : idOf(nextBefore),
})

describe('mergeMessages', () => {
  it('keeps one entry per id, oldest first, and a tombstone wins over a live copy', () => {
    const merged = mergeMessages([message(1), message(3)], [message(4), message(2), message(3)])
    expect(ids(merged)).toEqual([1, 2, 3, 4])
    const deleted = message(2, { body: '', deletedAt: new Date().toISOString() })
    expect(mergeMessages([deleted], [message(2)])[0]).toBe(deleted)
    expect(mergeMessages([message(2)], [deleted])[0]).toBe(deleted)
  })

  it('compares uuidv7 ids as lowercase text', () => {
    expect(compareIds(idOf(10), idOf(9))).toBe(1)
    expect(compareIds(idOf(10).toUpperCase(), idOf(10))).toBe(0)
  })
})

describe('history pages', () => {
  it('pages back without gaps or duplicates and stops at the oldest message', () => {
    let history = withNewestPage(EMPTY_HISTORY, page(51, 100, 51), null)
    expect(history).toMatchObject({ loaded: true, nextBefore: idOf(51) })
    history = withOlderPage(history, page(1, 50, null))
    expect(ids(history.messages)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1))
    expect(history.nextBefore).toBeNull()
  })

  it('merges a newest page that overlaps what is loaded (after a short drop) and keeps the cursor', () => {
    const before = withOlderPage(withNewestPage(EMPTY_HISTORY, page(51, 100, 51), null), page(1, 50, null))
    const after = withNewestPage(before, page(61, 110, 61), idOf(100))
    expect(ids(after.messages)).toEqual(Array.from({ length: 110 }, (_, i) => i + 1))
    expect(after.nextBefore).toBeNull()
  })

  it('drops the loaded messages when the newest page leaves a gap (more than a page missed)', () => {
    const before = withNewestPage(EMPTY_HISTORY, page(51, 100, 51), null)
    const after = withNewestPage(before, page(151, 200, 151), idOf(100))
    expect(ids(after.messages)).toEqual(Array.from({ length: 50 }, (_, i) => i + 151))
    expect(after.nextBefore).toBe(idOf(151))
  })

  it('finds the gap from the anchor, not from a message that came in during the reload', () => {
    // 1..120 loaded, 121..200 missed while offline; 201 (live, or the answer to an own message) lands first.
    const loaded = withOlderPage(withNewestPage(EMPTY_HISTORY, page(71, 120, 71), null), page(21, 70, 21))
    const withLive = { ...loaded, messages: mergeMessages(loaded.messages, [message(201)]) }
    const after = withNewestPage(withLive, page(152, 201, 152), idOf(120))
    expect(ids(after.messages)).toEqual(Array.from({ length: 50 }, (_, i) => i + 152))
    expect(after.nextBefore).toBe(idOf(152))
    const paged = withOlderPage(after, page(102, 151, 102))
    expect(ids(paged.messages)).toEqual(Array.from({ length: 100 }, (_, i) => i + 102))
  })

  it('takes the cursor of the page when nothing was loaded before', () => {
    const empty = withNewestPage(EMPTY_HISTORY, { messages: [], nextBefore: null }, null)
    const after = withNewestPage(empty, page(11, 60, 11), null)
    expect(after.nextBefore).toBe(idOf(11))
    expect(ids(after.messages)).toHaveLength(50)
  })

  it('keeps live messages that arrived before the first page', () => {
    const live = { ...EMPTY_HISTORY, messages: mergeMessages([], [message(101)]) }
    const loaded = withNewestPage(live, page(52, 101, 52), null)
    expect(ids(loaded.messages)).toEqual(Array.from({ length: 50 }, (_, i) => i + 52))
  })

  it('turns a message into a tombstone once', () => {
    const at = '2026-10-20T10:00:00.000Z'
    const list = withDeleted([message(1), message(2)], idOf(2), at)
    expect(list[1]).toMatchObject({ body: '', deletedAt: at })
    expect(withDeleted(list, idOf(2), '2026-10-20T11:00:00.000Z')).toBe(list)
  })
})

describe('chatRows', () => {
  it('folds runs of messages from blocked people into one line each', () => {
    const list = [message(1), message(2, { authorId: 'bob' }), message(3, { authorId: 'bob' }), message(4, { authorId: 'cy' }), message(5), message(6, { authorId: 'bob' })]
    const rows = chatRows(list, new Set(['bob', 'cy']))
    expect(rows.map((r) => (r.kind === 'message' ? r.message.authorId : `${r.count}/${r.people}`))).toEqual(['ann', '3/2', 'ann', '1/1'])
    expect(blockedRowText(1, 1)).toBe('1 message from a blocked person')
    expect(blockedRowText(2, 1)).toBe('2 messages from a blocked person')
    expect(blockedRowText(3, 2)).toBe('3 messages from blocked people')
  })
})
