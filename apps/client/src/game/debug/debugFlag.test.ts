import { describe, expect, it } from 'vitest'
import { mapDebugFromQuery } from './debugFlag.ts'

describe('mapDebugFromQuery', () => {
  it('turns the overlay on only for debug=1', () => {
    expect(mapDebugFromQuery('?debug=1')).toBe(true)
    expect(mapDebugFromQuery('?room=a&debug=1')).toBe(true)
    expect(mapDebugFromQuery('')).toBe(false)
    expect(mapDebugFromQuery('?debug=0')).toBe(false)
    expect(mapDebugFromQuery('?debug')).toBe(false)
  })
})
