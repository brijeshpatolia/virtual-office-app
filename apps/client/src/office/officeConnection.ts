import { ApiRequestError, errorMessage } from '../api/http.ts'
import { leaveReason, type JoinOffice, type OfficeConnectionHandle, type OfficeLink } from '../net/officeLink.ts'

// ErrorCode.AUTH_FAILED of @colyseus/sdk: onAuth threw ServerError(AUTH_FAILED).
export const MATCHMAKE_AUTH_FAILED = 525

// signed_out: the session is gone (the token route answered 401); the page sends the user to the sign-in page.
export type ClosedReason = 'replaced' | 'removed' | 'role_changed' | 'kicked' | 'lost' | 'denied' | 'signed_out' | 'error'

export type ConnectionState =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'connected'; link: OfficeLink; reconnecting: boolean }
  | { kind: 'closed'; reason: ClosedReason; detail: string }

// Matchmaking failed in onAuth (MatchMakeError 525), or the token route said no: the user may not enter.
export function isAccessDenied(error: unknown): boolean {
  if (error instanceof ApiRequestError) return ['forbidden', 'not_found'].includes(error.code)
  return error instanceof Error && error.name === 'MatchMakeError' && 'code' in error && error.code === MATCHMAKE_AUTH_FAILED
}

function closedReasonFor(error: unknown): ClosedReason {
  if (error instanceof ApiRequestError && error.code === 'unauthorized') return 'signed_out'
  return isAccessDenied(error) ? 'denied' : 'error'
}

// One office room connection with its lifecycle, outside React (useOfficeConnection subscribes to it).
// It never rejoins by itself after a close: a second tab or a removal must not start a tug of war.
export class OfficeConnection {
  private readonly officeId: string
  private readonly getToken: () => Promise<string>
  private readonly join: JoinOffice
  private readonly listeners = new Set<() => void>()
  private state: ConnectionState = { kind: 'idle' }
  private handle: OfficeConnectionHandle | null = null
  private attempt = 0

  constructor(officeId: string, getToken: () => Promise<string>, join: JoinOffice) {
    this.officeId = officeId
    this.getToken = getToken
    this.join = join
  }

  readonly getState = (): ConnectionState => this.state

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  connect(): void {
    this.disconnect()
    const attempt = this.attempt
    this.set({ kind: 'connecting' })
    void this.run(attempt)
  }

  // Leave the room (if any) and forget pending joins.
  disconnect(): void {
    this.attempt += 1
    const handle = this.handle
    this.handle = null
    if (handle) void handle.leave().catch(() => undefined)
    if (this.state.kind === 'connected' || this.state.kind === 'connecting') this.set({ kind: 'idle' })
  }

  private async run(attempt: number): Promise<void> {
    let handle: OfficeConnectionHandle
    try {
      handle = await this.join(this.officeId, await this.getToken())
    } catch (error) {
      if (attempt !== this.attempt) return
      this.set({ kind: 'closed', reason: closedReasonFor(error), detail: errorMessage(error) })
      return
    }
    if (attempt !== this.attempt) {
      void handle.leave().catch(() => undefined)
      return
    }
    this.handle = handle
    const { link } = handle
    handle.onDrop(() => this.handle === handle && this.set({ kind: 'connected', link, reconnecting: true }))
    handle.onReconnect(() => this.handle === handle && this.set({ kind: 'connected', link, reconnecting: false }))
    handle.onLeave((code) => {
      if (this.handle !== handle) return
      this.handle = null
      const reason = leaveReason(code)
      if (reason === 'left') this.set({ kind: 'idle' })
      else this.set({ kind: 'closed', reason, detail: `code ${code}` })
    })
    this.set({ kind: 'connected', link, reconnecting: false })
  }

  private set(state: ConnectionState): void {
    this.state = state
    for (const listener of [...this.listeners]) listener()
  }
}
