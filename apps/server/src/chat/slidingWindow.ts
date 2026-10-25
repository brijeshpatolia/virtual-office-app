// At most `limit` hits per key in any windowMs, in this process's memory. take() reserves a hit at once (no await
// between the check and the reservation, so concurrent calls cannot overshoot) and hands back a release function for
// a hit that did not count after all (a failed write or a duplicate).
export interface SlidingWindow {
  take(key: string, atMs: number): (() => void) | null
}

// Keys whose hits are all older than the window are pruned once the map grows past this size.
const PRUNE_AT = 10_000

export function createSlidingWindow(limit: number, windowMs: number): SlidingWindow {
  const hits = new Map<string, number[]>()
  const recent = (list: readonly number[], atMs: number) => list.filter((t) => atMs - t < windowMs)

  return {
    take(key, atMs) {
      const list = recent(hits.get(key) ?? [], atMs)
      if (list.length >= limit) {
        hits.set(key, list)
        return null
      }
      list.push(atMs)
      hits.set(key, list)
      if (hits.size > PRUNE_AT) {
        for (const [k, v] of hits) if (recent(v, atMs).length === 0) hits.delete(k)
      }
      return () => {
        const current = hits.get(key)
        const index = current?.lastIndexOf(atMs) ?? -1
        if (current !== undefined && index >= 0) current.splice(index, 1)
      }
    },
  }
}
