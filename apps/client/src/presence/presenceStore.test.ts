import { describe, expect, it } from 'vitest'
import type { PlayerState } from '@vo/shared'
import type { OfficeLink } from '../net/officeLink.ts'
import { PresenceStore } from './presenceStore.ts'

type Mutable = { -readonly [K in keyof PlayerState]: PlayerState[K] }

function fakeRoom() {
  const players = new Map<string, Mutable>()
  const adds: Array<(p: PlayerState, s: string) => void> = []
  const changes = new Map<PlayerState, Array<() => void>>()
  const link = {
    state: { players, seats: new Map() },
    onPlayerAdd: (h: (p: PlayerState, s: string) => void) => {
      for (const [s, p] of players) h(p, s)
      adds.push(h)
      return () => adds.splice(adds.indexOf(h), 1)
    },
    onPlayerRemove: () => () => undefined,
    onPlayerChange: (p: PlayerState, h: () => void) => {
      changes.set(p, [...(changes.get(p) ?? []), h])
      return () => changes.set(p, (changes.get(p) ?? []).filter((x) => x !== h))
    },
  } as unknown as OfficeLink
  const add = (sessionId: string, userId: string): Mutable => {
    const player: Mutable = { userId, name: userId, color: '#000000', x: 0, y: 0, dir: 'down', moving: false, zoneId: '', seatId: '', status: 'available', chosenStatus: 'available', statusText: '' }
    players.set(sessionId, player)
    for (const h of adds) h(player, sessionId)
    return player
  }
  const change = (player: Mutable, fields: Partial<Mutable>): void => {
    Object.assign(player, fields)
    for (const h of changes.get(player) ?? []) h()
  }
  return { link, add, change }
}

describe('PresenceStore', () => {
  it('publishes presence changes, not moves', () => {
    const room = fakeRoom()
    const ann = room.add('s1', 'ann')
    const store = new PresenceStore(room.link)
    let published = 0
    const stop = store.subscribe(() => published++)
    expect(store.getSnapshot().map((p) => p.userId)).toEqual(['ann'])
    const before = published
    room.change(ann, { x: 10, y: 20, moving: true })
    expect(published).toBe(before)
    room.change(ann, { status: 'busy', statusText: 'In a call' })
    expect(published).toBe(before + 1)
    expect(store.getSnapshot()[0]).toMatchObject({ status: 'busy', statusText: 'In a call' })
    room.add('s2', 'bob')
    expect(store.getSnapshot().map((p) => p.userId)).toEqual(['ann', 'bob'])
    stop()
  })
})
