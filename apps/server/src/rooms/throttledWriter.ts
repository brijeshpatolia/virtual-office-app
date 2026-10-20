// Database writes that a client can trigger at a high rate (chat:read, status:set): per key, the first value is
// written at once, then at most one write per intervalMs; values that arrive in between are merged into one write.
// A failed write is logged and dropped. flush() writes what is pending now and waits for every write.
export interface ThrottledWriter<V> {
  push(key: string, value: V): void
  flush(): Promise<void>
  // Writes what is pending for one key now (without waiting for the interval) and waits for it.
  flushKey(key: string): Promise<void>
}

export const WRITE_INTERVAL_MS = 1000

interface Entry<V> {
  next: { value: V } | null
  writing: Promise<void> | null
  timer: ReturnType<typeof setTimeout> | null
}

export function createThrottledWriter<V>(options: {
  write: (key: string, value: V) => Promise<void>
  // How a pending value and a newer one become one (default: the newer one).
  merge?: (pending: V, next: V) => V
  intervalMs?: number
  name: string
}): ThrottledWriter<V> {
  const intervalMs = options.intervalMs ?? WRITE_INTERVAL_MS
  const entries = new Map<string, Entry<V>>()

  const start = (key: string, entry: Entry<V>): void => {
    if (entry.next === null) {
      if (entries.get(key) === entry) entries.delete(key)
      return
    }
    const { value } = entry.next
    entry.next = null
    entry.writing = options
      .write(key, value)
      .catch((error: unknown) => console.error(`${options.name}: a write failed:`, error))
      .finally(() => {
        entry.writing = null
        entry.timer = setTimeout(() => {
          entry.timer = null
          start(key, entry)
        }, intervalMs)
        entry.timer.unref()
      })
  }

  return {
    push(key, value) {
      let entry = entries.get(key)
      if (entry === undefined) {
        entry = { next: null, writing: null, timer: null }
        entries.set(key, entry)
      }
      entry.next = { value: entry.next !== null && options.merge ? options.merge(entry.next.value, value) : value }
      if (entry.writing === null && entry.timer === null) start(key, entry)
    },

    async flushKey(key) {
      for (let entry = entries.get(key); entry !== undefined; entry = entries.get(key)) {
        if (entry.timer !== null) {
          clearTimeout(entry.timer)
          entry.timer = null
        }
        if (entry.writing === null) start(key, entry)
        if (entry.writing === null) return
        await entry.writing
      }
    },

    async flush() {
      while (entries.size > 0) {
        const writes: Promise<void>[] = []
        for (const [key, entry] of entries) {
          if (entry.timer !== null) {
            clearTimeout(entry.timer)
            entry.timer = null
          }
          if (entry.writing === null) start(key, entry)
          if (entry.writing !== null) writes.push(entry.writing)
        }
        await Promise.all(writes)
      }
    },
  }
}
