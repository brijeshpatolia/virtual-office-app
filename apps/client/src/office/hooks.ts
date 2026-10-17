import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { AccessTokenSource } from '../api/accessToken.ts'
import { fetchRtToken } from '../api/endpoints.ts'
import type { JoinOffice } from '../net/officeLink.ts'
import { OfficeConnection, type ConnectionState } from './officeConnection.ts'

// The realtime token for this office, in memory only, refreshed in the background while the page is open.
export function useAccessToken(officeId: string): () => Promise<string> {
  const tokens = useMemo(() => new AccessTokenSource(() => fetchRtToken(officeId)), [officeId])
  useEffect(() => {
    tokens.start()
    return () => tokens.stop()
  }, [tokens])
  return useCallback(() => tokens.get(), [tokens])
}

// Joins the office room while the page is open. reconnect() joins again after a close (e.g. "Use this tab").
export function useOfficeConnection(
  officeId: string,
  getToken: () => Promise<string>,
  join: JoinOffice,
): [state: ConnectionState, reconnect: () => void] {
  const connection = useMemo(() => new OfficeConnection(officeId, getToken, join), [officeId, getToken, join])
  useEffect(() => {
    // StrictMode runs this effect twice in a row in dev; the timer lets only the second run join.
    const timer = window.setTimeout(() => connection.connect(), 0)
    // Closing the tab or leaving the page: leave the room with consent, so the others see the avatar (and its seat)
    // go at once instead of after the 30 s reconnection wait. A page restored from the back-forward cache joins again.
    const onPageHide = (): void => connection.disconnect()
    const onPageShow = (event: PageTransitionEvent): void => {
      if (event.persisted) connection.connect()
    }
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('pageshow', onPageShow)
      connection.disconnect()
    }
  }, [connection])
  const state = useSyncExternalStore(connection.subscribe, connection.getState)
  const reconnect = useCallback(() => connection.connect(), [connection])
  return [state, reconnect]
}
