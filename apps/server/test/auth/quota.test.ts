import { describe, expect, it } from 'vitest'
import { SlidingQuota } from '../../src/auth/quota.ts'

describe('SlidingQuota', () => {
  it('counts per key in a sliding window and counts nothing when one rule is full', () => {
    let now = 0
    const quota = new SlidingQuota(1000, () => now)
    const rules = (to: string) => [
      { key: 'inviter:a', max: 3 },
      { key: `to:${to}`, max: 2 },
    ]
    expect(quota.take(rules('x'))).toBe(true)
    expect(quota.take(rules('x'))).toBe(true)
    expect(quota.take(rules('x'))).toBe(false)
    // The refused take did not count for the inviter.
    expect(quota.take(rules('y'))).toBe(true)
    expect(quota.take(rules('z'))).toBe(false)
    now = 999
    expect(quota.take(rules('z'))).toBe(false)
    now = 1001
    expect(quota.take(rules('z'))).toBe(true)
    expect(quota.take(rules('x'))).toBe(true)
  })
})
