import { describe, expect, it } from 'vitest'
import type { MemberSummary } from '@vo/shared'
import { canModerate, mergePeople, ownStatusLabel, type PresencePlayer } from './people.ts'

const member = (userId: string, name: string, role: MemberSummary['role']): MemberSummary => ({
  userId,
  name,
  role,
  joinedAt: '2026-10-01T00:00:00.000Z',
})
const player = (userId: string, name: string, status: PresencePlayer['status'], statusText = ''): PresencePlayer => ({
  sessionId: `s-${userId}`,
  userId,
  name,
  status,
  chosenStatus: status === 'away' ? 'available' : status,
  statusText,
})

describe('mergePeople', () => {
  it('lists you first, then online people, then offline members, each by name', () => {
    const members = [member('me', 'Me', 'member'), member('zed', 'Zed', 'admin'), member('amy', 'Amy', 'member'), member('bo', 'Bo', 'owner')]
    const players = [player('zed', 'Zed', 'busy', 'In a call'), player('me', 'Me', 'available'), player('guest', 'Gus', 'dnd')]
    const people = mergePeople(members, players, 'me')
    expect(people.map((p) => [p.userId, p.online, p.status, p.role])).toEqual([
      ['me', true, 'available', 'member'],
      ['guest', true, 'dnd', null],
      ['zed', true, 'busy', 'admin'],
      ['amy', false, null, 'member'],
      ['bo', false, null, 'owner'],
    ])
    expect(people.find((p) => p.userId === 'zed')?.statusText).toBe('In a call')
  })

  it('shows guests the people in the room only', () => {
    const people = mergePeople(null, [player('a', 'Ann', 'away'), player('a', 'Ann', 'away'), player('g', 'Guest', 'available')], 'g')
    expect(people.map((p) => p.userId)).toEqual(['g', 'a'])
  })
})

describe('ownStatusLabel', () => {
  it('explains when the server shows something else than what was picked', () => {
    expect(ownStatusLabel('available', 'available')).toBe('Available')
    expect(ownStatusLabel('available', 'busy')).toBe('Busy (meeting room)')
    expect(ownStatusLabel('busy', 'busy')).toBe('Busy')
    expect(ownStatusLabel('busy', 'away')).toBe('Away')
    expect(ownStatusLabel('dnd', 'dnd')).toBe('Do not disturb')
  })
})

describe('canModerate', () => {
  it('lets owners and admins act on lower roles only, never on themselves', () => {
    const as = (userId: string, role: MemberSummary['role']) => ({ userId, role })
    expect(canModerate(as('o', 'owner'), as('a', 'admin'))).toBe(true)
    expect(canModerate(as('a', 'admin'), as('m', 'member'))).toBe(true)
    expect(canModerate(as('a', 'admin'), as('g', 'guest'))).toBe(true)
    expect(canModerate(as('a', 'admin'), as('a2', 'admin'))).toBe(false)
    expect(canModerate(as('a', 'admin'), as('o', 'owner'))).toBe(false)
    expect(canModerate(as('m', 'member'), as('g', 'guest'))).toBe(false)
    expect(canModerate(as('o', 'owner'), as('o', 'owner'))).toBe(false)
  })
})
