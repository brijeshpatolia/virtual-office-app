import { describe, expect, it, vi } from 'vitest'
import { ACCESS_TOKEN_REFRESH_MS, ACCESS_TOKEN_TTL_MS } from '@vo/shared'
import { AccessTokenSource, MIN_REFRESH_MS, refreshDelayMs, REFRESH_MARGIN_MS, RETRY_MS, type TokenClock } from './accessToken.ts'

describe('refreshDelayMs', () => {
  it('refreshes after ACCESS_TOKEN_REFRESH_MS for a normal 15 min token', () => {
    expect(refreshDelayMs(1_000 + ACCESS_TOKEN_TTL_MS, 1_000)).toBe(ACCESS_TOKEN_REFRESH_MS)
  })

  it('refreshes earlier when the token expires sooner, but not in a tight loop', () => {
    expect(refreshDelayMs(5 * 60_000, 0)).toBe(5 * 60_000 - REFRESH_MARGIN_MS)
    expect(refreshDelayMs(60_000, 0)).toBe(MIN_REFRESH_MS)
  })

  it('falls back to the default when the client clock disagrees with the server', () => {
    expect(refreshDelayMs(0, 60 * 60_000)).toBe(ACCESS_TOKEN_REFRESH_MS)
    expect(refreshDelayMs(5 * 60 * 60_000, 0)).toBe(ACCESS_TOKEN_REFRESH_MS)
  })
})

function fakeClock() {
  let now = 0
  const timers: Array<{ at: number; callback: () => void; id: number }> = []
  let nextId = 0
  const clock: TokenClock = {
    now: () => now,
    setTimeout: (callback, ms) => {
      const id = ++nextId
      timers.push({ at: now + ms, callback, id })
      return id
    },
    clearTimeout: (handle) => {
      const i = timers.findIndex((t) => t.id === handle)
      if (i >= 0) timers.splice(i, 1)
    },
  }
  const advance = async (ms: number) => {
    now += ms
    for (const timer of timers.filter((t) => t.at <= now)) {
      timers.splice(timers.indexOf(timer), 1)
      timer.callback()
    }
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  }
  return { clock, advance, pending: () => timers.length, now: () => now }
}

describe('AccessTokenSource', () => {
  it('fetches once, serves the cached token and refreshes in the background before expiry', async () => {
    const { clock, advance, now } = fakeClock()
    let n = 0
    const fetchGrant = vi.fn(async () => ({ token: `t${++n}`, expiresAt: new Date(now() + ACCESS_TOKEN_TTL_MS).toISOString() }))
    const source = new AccessTokenSource(fetchGrant, clock)
    source.start()
    await expect(source.get()).resolves.toBe('t1')
    expect(fetchGrant).toHaveBeenCalledTimes(1)

    await advance(ACCESS_TOKEN_REFRESH_MS - 1)
    await expect(source.get()).resolves.toBe('t1')
    expect(fetchGrant).toHaveBeenCalledTimes(1)

    await advance(1)
    expect(fetchGrant).toHaveBeenCalledTimes(2)
    await expect(source.get()).resolves.toBe('t2')
    source.stop()
  })

  it('fetches on demand without start() and dedupes parallel calls', async () => {
    const { clock } = fakeClock()
    const fetchGrant = vi.fn(async () => ({ token: 'only', expiresAt: new Date(ACCESS_TOKEN_TTL_MS).toISOString() }))
    const source = new AccessTokenSource(fetchGrant, clock)
    const [a, b] = await Promise.all([source.get(), source.get()])
    expect([a, b]).toEqual(['only', 'only'])
    expect(fetchGrant).toHaveBeenCalledTimes(1)
  })

  it('retries a failed background refresh and stops after stop()', async () => {
    const { clock, advance, pending } = fakeClock()
    const fetchGrant = vi.fn(async () => {
      throw new Error('offline')
    })
    const source = new AccessTokenSource(fetchGrant, clock)
    source.start()
    await advance(0)
    await expect(source.get()).rejects.toThrow('offline')
    await advance(RETRY_MS)
    expect(fetchGrant.mock.calls.length).toBeGreaterThanOrEqual(3)
    source.stop()
    expect(pending()).toBe(0)
  })
})
