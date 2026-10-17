import { useEffect, useState } from 'react'

export type Resource<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; error: unknown }

const LOADING = { status: 'loading' } as const

// Loads fetcher(arg) and again whenever arg or version changes; arg null = do not load.
// Pass a stable fetcher (a module-level function).
export function useResource<T>(fetcher: (arg: string) => Promise<T>, arg: string | null, version = 0): Resource<T> {
  const [entry, setEntry] = useState<{ arg: string; version: number; result: Resource<T> } | null>(null)

  useEffect(() => {
    if (arg === null) return
    let live = true
    fetcher(arg).then(
      (data) => {
        if (live) setEntry({ arg, version, result: { status: 'ready', data } })
      },
      (error: unknown) => {
        if (live) setEntry({ arg, version, result: { status: 'error', error } })
      },
    )
    return () => {
      live = false
    }
  }, [fetcher, arg, version])

  return entry && entry.arg === arg && entry.version === version ? entry.result : LOADING
}
