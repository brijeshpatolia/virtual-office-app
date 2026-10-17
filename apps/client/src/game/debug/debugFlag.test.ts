import { describe, expect, it } from 'vitest'
import { isMapDebugKey, mapDebugFromQuery } from './debugFlag.ts'

describe('mapDebugFromQuery', () => {
  it('turns the overlay on only for debug=1', () => {
    expect(mapDebugFromQuery('?debug=1')).toBe(true)
    expect(mapDebugFromQuery('?room=a&debug=1')).toBe(true)
    expect(mapDebugFromQuery('')).toBe(false)
    expect(mapDebugFromQuery('?debug=0')).toBe(false)
    expect(mapDebugFromQuery('?debug')).toBe(false)
  })
})

describe('isMapDebugKey', () => {
  it('matches the key left of 1 on any layout and a typed backquote', () => {
    expect(isMapDebugKey({ code: 'Backquote', key: '`' })).toBe(true)
    // German ^ and French ², both on the key left of 1.
    expect(isMapDebugKey({ code: 'Backquote', key: '^' })).toBe(true)
    expect(isMapDebugKey({ code: 'Backquote', key: '²' })).toBe(true)
    // A backquote typed elsewhere: German nodeadkeys, French AltGr+7.
    expect(isMapDebugKey({ code: 'Equal', key: '`' })).toBe(true)
    expect(isMapDebugKey({ code: 'Digit7', key: '`' })).toBe(true)
  })

  it('ignores other keys, including a dead key', () => {
    expect(isMapDebugKey({ code: 'Equal', key: 'Dead' })).toBe(false)
    expect(isMapDebugKey({ code: 'KeyA', key: 'a' })).toBe(false)
  })
})
