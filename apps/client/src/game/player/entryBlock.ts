import type { MoveRejectReason } from '@vo/shared'
import { NO_INPUT, type DirectionInput } from './input.ts'

export type EntryRejectReason = Extract<MoveRejectReason, 'guest' | 'full' | 'locked'>

const TEXT: Record<EntryRejectReason, string> = {
  guest: 'Guests cannot go in there.',
  full: 'That room is full.',
  locked: 'That room is locked.',
}

export const ENTRY_TOAST_GAP_MS = 4000

export function isEntryReject(reason: MoveRejectReason): reason is EntryRejectReason {
  return Object.hasOwn(TEXT, reason)
}

type Direction = keyof DirectionInput
const DIRECTIONS: readonly Direction[] = ['up', 'down', 'left', 'right']

// After the server refused to let the avatar into a zone (guest, full, locked), the keys that pushed it there stop
// walking until they are released, so a held key does not bounce the avatar off the doorway many times a second.
export class EntryBlock {
  private readonly blocked = new Set<Direction>()
  private readonly toastAt = new Map<EntryRejectReason, number>()

  // The directions held when the reject came in. Returns the toast to show, or null when it was shown just now.
  block(held: DirectionInput, reason: EntryRejectReason, now: number): string | null {
    for (const direction of DIRECTIONS) if (held[direction]) this.blocked.add(direction)
    const last = this.toastAt.get(reason)
    if (last !== undefined && now - last < ENTRY_TOAST_GAP_MS) return null
    this.toastAt.set(reason, now)
    return TEXT[reason]
  }

  // The input without the blocked directions; a released direction is free again.
  filter(input: DirectionInput): DirectionInput {
    if (this.blocked.size === 0) return input
    const out = { ...NO_INPUT }
    for (const direction of DIRECTIONS) {
      if (!input[direction]) this.blocked.delete(direction)
      else if (!this.blocked.has(direction)) out[direction] = true
    }
    return out
  }
}
