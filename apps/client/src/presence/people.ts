import type { ChosenStatus, MemberSummary, OrgRole, PlayerState, PlayerStatus } from '@vo/shared'

// The presence fields of a player in the room (no position, so moves do not re-render the panels).
export interface PresencePlayer {
  sessionId: string
  userId: string
  name: string
  status: PlayerStatus
  chosenStatus: ChosenStatus
  statusText: string
}

export function presencePlayer(sessionId: string, player: PlayerState): PresencePlayer {
  const { userId, name, status, chosenStatus, statusText } = player
  return { sessionId, userId, name, status, chosenStatus, statusText }
}

export const presenceKey = (p: PresencePlayer): string => `${p.userId}\n${p.name}\n${p.status}\n${p.chosenStatus}\n${p.statusText}`

export interface Person {
  userId: string
  name: string
  // null: unknown (a guest viewer, or someone who joined after the list was loaded).
  role: OrgRole | null
  online: boolean
  // null when offline.
  status: PlayerStatus | null
  statusText: string
  self: boolean
}

// The company's members joined with the people in the room: you first, then online, then offline, by name.
export function mergePeople(members: readonly MemberSummary[] | null, players: readonly PresencePlayer[], selfId: string): Person[] {
  const online = new Map<string, PresencePlayer>()
  for (const player of players) if (!online.has(player.userId)) online.set(player.userId, player)
  const people = new Map<string, Person>()
  for (const member of members ?? []) {
    const player = online.get(member.userId)
    people.set(member.userId, {
      userId: member.userId,
      name: player?.name ?? member.name,
      role: member.role,
      online: player !== undefined,
      status: player?.status ?? null,
      statusText: player?.statusText ?? '',
      self: member.userId === selfId,
    })
  }
  for (const player of online.values()) {
    if (people.has(player.userId)) continue
    people.set(player.userId, {
      userId: player.userId,
      name: player.name,
      role: null,
      online: true,
      status: player.status,
      statusText: player.statusText,
      self: player.userId === selfId,
    })
  }
  const rank = (p: Person): number => (p.self ? 0 : p.online ? 1 : 2)
  return [...people.values()].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

export const STATUS_LABEL: Record<PlayerStatus, string> = {
  available: 'Available',
  busy: 'Busy',
  dnd: 'Do not disturb',
  away: 'Away',
}

// The own status as the header shows it: what was picked, and why it differs when the server overrides it.
export function ownStatusLabel(chosen: ChosenStatus, effective: PlayerStatus): string {
  if (effective === 'away' && chosen !== 'dnd') return 'Away'
  if (chosen === 'available' && effective === 'busy') return 'Busy (meeting room)'
  return STATUS_LABEL[chosen]
}

export const ROLE_LABEL: Record<OrgRole, string> = { owner: 'Owner', admin: 'Admin', member: 'Member', guest: 'Guest' }

const ROLE_RANK: Record<OrgRole, number> = { owner: 3, admin: 2, member: 1, guest: 0 }

// Same rule as the server (chat/moderation.ts): owners and admins act on a lower role, never on themselves. The UI
// only hides what the server would refuse.
export function canModerate(actor: { userId: string; role: OrgRole }, target: { userId: string; role: OrgRole }): boolean {
  if (actor.userId === target.userId) return false
  if (actor.role !== 'owner' && actor.role !== 'admin') return false
  return ROLE_RANK[actor.role] > ROLE_RANK[target.role]
}

// 15 min, 1 h, 24 h and 7 days; 0 unmutes.
export const MUTE_CHOICES: ReadonlyArray<{ minutes: number; label: string }> = [
  { minutes: 15, label: '15 minutes' },
  { minutes: 60, label: '1 hour' },
  { minutes: 24 * 60, label: '24 hours' },
  { minutes: 7 * 24 * 60, label: '7 days' },
]
