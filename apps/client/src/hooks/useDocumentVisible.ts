import { useSyncExternalStore } from 'react'

const subscribe = (onChange: () => void): (() => void) => {
  document.addEventListener('visibilitychange', onChange)
  return () => document.removeEventListener('visibilitychange', onChange)
}

// The tab is visible (Page Visibility API).
export function useDocumentVisible(): boolean {
  return useSyncExternalStore(subscribe, () => !document.hidden)
}
