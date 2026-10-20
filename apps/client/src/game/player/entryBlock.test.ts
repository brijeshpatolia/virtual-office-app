import { describe, expect, it } from 'vitest'
import { NO_INPUT } from './input.ts'
import { ENTRY_TOAST_GAP_MS, EntryBlock, isEntryReject } from './entryBlock.ts'

const held = (keys: Partial<typeof NO_INPUT>) => ({ ...NO_INPUT, ...keys })

describe('EntryBlock', () => {
  it('stops the held keys after a zone reject until they are released', () => {
    const block = new EntryBlock()
    expect(block.filter(held({ right: true }))).toEqual(held({ right: true }))
    expect(block.block(held({ right: true, up: true }), 'guest', 0)).toBe('Guests cannot go in there.')
    expect(block.filter(held({ right: true, up: true }))).toEqual(NO_INPUT)
    // Another direction still walks.
    expect(block.filter(held({ right: true, left: true }))).toEqual(held({ left: true }))
    // up was released in the last frame; right is still held.
    expect(block.filter(held({ right: true, up: true }))).toEqual(held({ up: true }))
    expect(block.filter(NO_INPUT)).toEqual(NO_INPUT)
    expect(block.filter(held({ right: true }))).toEqual(held({ right: true }))
  })

  it('shows one toast per reason at most every few seconds', () => {
    const block = new EntryBlock()
    expect(block.block(held({ right: true }), 'full', 0)).toBe('That room is full.')
    expect(block.block(held({ right: true }), 'full', ENTRY_TOAST_GAP_MS - 1)).toBeNull()
    expect(block.block(held({ right: true }), 'guest', 10)).toBe('Guests cannot go in there.')
    expect(block.block(held({ right: true }), 'full', ENTRY_TOAST_GAP_MS)).toBe('That room is full.')
  })

  it('knows which rejects are zone entries', () => {
    expect(isEntryReject('guest')).toBe(true)
    expect(isEntryReject('locked')).toBe(true)
    expect(isEntryReject('collision')).toBe(false)
    expect(isEntryReject('speed')).toBe(false)
  })
})
