import { describe, expect, it } from 'vitest'
import { SIT_RADIUS, type SeatDef } from '@vo/shared'
import { nearestFreeSeat, SEAT_HINT_RADIUS, seatHint, sitRejectText } from './seats.ts'

const seat = (id: string, x: number, y: number, hasComputer = false): SeatDef => ({
  id,
  zoneId: 'z',
  x,
  y,
  facing: 'up',
  hasComputer,
  computer: hasComputer ? { col: 0, row: 0 } : null,
})

const seats = [seat('a', 100, 100), seat('b', 130, 100, true), seat('far', 400, 400)]

describe('nearestFreeSeat', () => {
  it('picks the closest free seat within SIT_RADIUS', () => {
    expect(nearestFreeSeat(seats, { x: 120, y: 100 }, () => true)?.id).toBe('b')
    expect(nearestFreeSeat(seats, { x: 120, y: 100 }, (id) => id !== 'b')?.id).toBe('a')
    expect(nearestFreeSeat(seats, { x: 100 + SIT_RADIUS, y: 100 }, (id) => id === 'a')?.id).toBe('a')
    expect(nearestFreeSeat(seats, { x: 100 - SIT_RADIUS - 1, y: 100 }, () => true)).toBeNull()
  })

  it('hints a seat 8 px closer than the server allows', () => {
    expect(SIT_RADIUS - SEAT_HINT_RADIUS).toBe(8)
    expect(nearestFreeSeat(seats, { x: 100 - SEAT_HINT_RADIUS, y: 100 }, () => true, SEAT_HINT_RADIUS)?.id).toBe('a')
    expect(nearestFreeSeat(seats, { x: 100 - SEAT_HINT_RADIUS - 1, y: 100 }, () => true, SEAT_HINT_RADIUS)).toBeNull()
  })
})

describe('seatHint', () => {
  it('names the action for the E key', () => {
    expect(seatHint(true, null)).toBe('E: stand')
    expect(seatHint(false, seats[0] ?? null)).toBe('E: sit')
    expect(seatHint(false, seats[1] ?? null)).toBe('E: sit (computer)')
    expect(seatHint(false, null)).toBeNull()
  })
})

describe('sitRejectText', () => {
  it('explains each reject reason and has a fallback', () => {
    expect(sitRejectText('taken')).toMatch(/someone/i)
    expect(sitRejectText('far')).toMatch(/closer/i)
    expect(sitRejectText(null)).toMatch(/could not/i)
    expect(sitRejectText('toString')).toMatch(/could not/i)
  })
})
