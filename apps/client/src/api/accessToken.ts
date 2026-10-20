import { ACCESS_TOKEN_REFRESH_MS, ACCESS_TOKEN_TTL_MS } from '@vo/shared'

// The realtime JWT (GET /api/rt-token), kept in memory only and fetched again before it expires.

// Refresh this long before the server's expiry, but never more often than MIN_REFRESH_MS.
export const REFRESH_MARGIN_MS = 2 * 60_000
export const MIN_REFRESH_MS = 10_000
// After a failed refresh.
export const RETRY_MS = 30_000

export interface TokenGrant {
  token: string
  // ISO time from the server.
  expiresAt: string
}

// How long after receiving a token to fetch the next one: ACCESS_TOKEN_REFRESH_MS, or earlier when the server's
// expiry is closer. Counted from the local receive time, so a client clock that is off by minutes falls back to
// the default instead of refreshing in a loop or too late.
export function refreshDelayMs(expiresAtMs: number, receivedAtMs: number): number {
  const remaining = expiresAtMs - receivedAtMs
  if (!(remaining > 0 && remaining <= ACCESS_TOKEN_TTL_MS + REFRESH_MARGIN_MS)) return ACCESS_TOKEN_REFRESH_MS
  return Math.max(MIN_REFRESH_MS, Math.min(ACCESS_TOKEN_REFRESH_MS, remaining - REFRESH_MARGIN_MS))
}

export interface TokenClock {
  now(): number
  setTimeout(callback: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

const browserClock: TokenClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (handle) => window.clearTimeout(handle as number),
}

export class AccessTokenSource {
  private readonly fetchGrant: () => Promise<TokenGrant>
  private readonly clock: TokenClock
  private current: { token: string; refreshAt: number } | null = null
  private inFlight: Promise<string> | null = null
  private timer: unknown = null
  private running = false

  constructor(fetchGrant: () => Promise<TokenGrant>, clock: TokenClock = browserClock) {
    this.fetchGrant = fetchGrant
    this.clock = clock
  }

  // A token that is not due for refresh yet; fetches one when needed. Rejects when the fetch fails.
  get(): Promise<string> {
    if (this.current && this.clock.now() < this.current.refreshAt) return Promise.resolve(this.current.token)
    return this.fetch()
  }

  // Keep a fresh token ready until stop().
  start(): void {
    if (this.running) return
    this.running = true
    this.fetch().catch(() => undefined)
  }

  stop(): void {
    this.running = false
    this.current = null
    if (this.timer !== null) this.clock.clearTimeout(this.timer)
    this.timer = null
  }

  private fetch(): Promise<string> {
    this.inFlight ??= this.fetchGrant()
      .then(
        (grant) => {
          const receivedAt = this.clock.now()
          const delay = refreshDelayMs(Date.parse(grant.expiresAt), receivedAt)
          this.current = { token: grant.token, refreshAt: receivedAt + delay }
          this.schedule(delay)
          return grant.token
        },
        (error: unknown) => {
          this.schedule(RETRY_MS)
          throw error
        },
      )
      .finally(() => {
        this.inFlight = null
      })
    return this.inFlight
  }

  private schedule(ms: number): void {
    if (!this.running) return
    if (this.timer !== null) this.clock.clearTimeout(this.timer)
    this.timer = this.clock.setTimeout(() => {
      this.timer = null
      this.fetch().catch(() => undefined)
    }, ms)
  }
}
