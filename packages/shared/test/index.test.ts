import { describe, expect, it } from 'vitest'
import { SHARED_PACKAGE } from '../src/index.ts'

describe('@vo/shared', () => {
  it('exports its package name', () => {
    expect(SHARED_PACKAGE).toBe('@vo/shared')
  })
})
