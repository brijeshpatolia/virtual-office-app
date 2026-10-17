export interface QuotaRule {
  key: string
  max: number
}

const MAX_KEYS = 50_000

// Counts events per key in a sliding window, in the memory of this process (P1 runs one server process).
export class SlidingQuota {
  readonly #windowMs: number
  readonly #now: () => number
  readonly #events = new Map<string, number[]>()

  constructor(windowMs: number, now: () => number = Date.now) {
    this.#windowMs = windowMs
    this.#now = now
  }

  // Counts one event for every rule's key when none of them has reached its max; false, and nothing counted, else.
  take(rules: readonly QuotaRule[]): boolean {
    const now = this.#now()
    const recent = rules.map((rule) => this.#recent(rule.key, now))
    if (rules.some((rule, i) => (recent[i]?.length ?? 0) >= rule.max)) return false
    if (this.#events.size >= MAX_KEYS) this.#prune(now)
    rules.forEach((rule, i) => this.#events.set(rule.key, [...(recent[i] ?? []), now]))
    return true
  }

  #recent(key: string, now: number): number[] {
    return (this.#events.get(key) ?? []).filter((at) => at > now - this.#windowMs)
  }

  #prune(now: number): void {
    for (const [key, times] of this.#events) if (!times.some((at) => at > now - this.#windowMs)) this.#events.delete(key)
    if (this.#events.size >= MAX_KEYS) this.#events.clear()
  }
}
