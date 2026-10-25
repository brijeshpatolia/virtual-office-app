import { useMemo, useSyncExternalStore } from 'react'
import type { PlayerState } from '@vo/shared'
import type { OfficeLink, Unsubscribe } from '../net/officeLink.ts'
import { presenceKey, presencePlayer, type PresencePlayer } from './people.ts'

const NONE: readonly PresencePlayer[] = []

// The presence fields of the players in the room, for React. It listens to the link only while something reads
// it, and makes a new snapshot only when a presence field changed (not on every move).
export class PresenceStore {
  private readonly link: OfficeLink
  private readonly listeners = new Set<() => void>()
  private readonly entries = new Map<string, { player: PresencePlayer; unsubscribe: Unsubscribe }>()
  private stops: Unsubscribe[] = []
  private snapshot: readonly PresencePlayer[]

  constructor(link: OfficeLink) {
    this.link = link
    this.snapshot = [...link.state.players].map(([sessionId, player]) => presencePlayer(sessionId, player))
  }

  readonly getSnapshot = (): readonly PresencePlayer[] => this.snapshot

  readonly subscribe = (listener: () => void): Unsubscribe => {
    this.listeners.add(listener)
    if (this.listeners.size === 1) this.start()
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) this.stop()
    }
  }

  private start(): void {
    this.stops = [
      this.link.onPlayerAdd((player, sessionId) => this.add(player, sessionId)),
      this.link.onPlayerRemove((_player, sessionId) => {
        this.entries.get(sessionId)?.unsubscribe()
        if (this.entries.delete(sessionId)) this.publish()
      }),
    ]
    this.publish()
  }

  private stop(): void {
    for (const stop of this.stops.splice(0)) stop()
    for (const entry of this.entries.values()) entry.unsubscribe()
    this.entries.clear()
  }

  private add(player: PlayerState, sessionId: string): void {
    this.entries.get(sessionId)?.unsubscribe()
    const unsubscribe = this.link.onPlayerChange(player, () => {
      const entry = this.entries.get(sessionId)
      const next = presencePlayer(sessionId, player)
      if (!entry || presenceKey(entry.player) === presenceKey(next)) return
      entry.player = next
      this.publish()
    })
    this.entries.set(sessionId, { player: presencePlayer(sessionId, player), unsubscribe })
    this.publish()
  }

  private publish(): void {
    this.snapshot = [...this.entries.values()].map((entry) => entry.player)
    for (const listener of [...this.listeners]) listener()
  }
}

// The people in the room; empty without a connection.
export function usePresence(link: OfficeLink | null): readonly PresencePlayer[] {
  const store = useMemo(() => (link ? new PresenceStore(link) : null), [link])
  return useSyncExternalStore(store?.subscribe ?? noSubscribe, store?.getSnapshot ?? noPlayers)
}

const noSubscribe = (): Unsubscribe => () => undefined
const noPlayers = (): readonly PresencePlayer[] => NONE
