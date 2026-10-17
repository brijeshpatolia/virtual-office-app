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
    return () => {
      window.clearTimeout(timer)
      connection.disconnect()
    }
  }, [connection])
  const state = useSyncExternalStore(connection.subscribe, connection.getState)
  const reconnect = useCallback(() => connection.connect(), [connection])
  return [state, reconnect]
}
