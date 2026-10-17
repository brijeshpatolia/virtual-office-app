import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react'
import { matchRoute, type Route } from './routes.ts'

// A tiny History API router: navigate() changes the URL, useRoute() re-renders on every change.
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  window.addEventListener('popstate', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('popstate', listener)
  }
}

const currentUrl = (): string => `${window.location.pathname}${window.location.search}`

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (to === currentUrl()) return
  if (options.replace) window.history.replaceState(null, '', to)
  else window.history.pushState(null, '', to)
  for (const listener of listeners) listener()
}

export function useCurrentUrl(): string {
  return useSyncExternalStore(subscribe, currentUrl)
}

export function useRoute(): Route {
  const url = new URL(useCurrentUrl(), window.location.origin)
  return matchRoute(url.pathname, url.search, { dev: import.meta.env.DEV })
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { to: string }

export function Link({ to, onClick, ...rest }: LinkProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(event)
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return
    }
    event.preventDefault()
    navigate(to)
  }
  return <a href={to} onClick={handleClick} {...rest} />
}
