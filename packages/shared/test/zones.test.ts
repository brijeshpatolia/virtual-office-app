import { describe, expect, it } from 'vitest'
import type { ZoneDef } from '../src/types.ts'
import { zoneAt, ZoneTracker } from '../src/zones.ts'
import { center, parsedWith } from './helpers/tiledMap.ts'

const map = parsedWith()

function zone(id: string, x: number, y: number, w: number, h: number, priority = 0): ZoneDef {
  return { id, zoneType: 'openplan', mediaMode: 'proximity', capacity: 0, lockable: false, priority, rect: { x, y, w, h } }
}

const at = (col: number, row: number) => {
  const c = center(col, row)
  return zoneAt(map, c.x, c.y)?.id ?? null
}

describe('zoneAt', () => {
  it('finds the zone that contains the point', () => {
    expect(at(2, 2)).toBe('room')
    expect(at(6, 2)).toBe('open')
  })

  it('prefers a nested zone with a higher priority', () => {
    expect(at(7, 4)).toBe('desk')
    expect(at(6, 4)).toBe('open')
  })

  it('returns null for doors and walls', () => {
    expect(at(5, 3)).toBeNull()
    expect(at(0, 0)).toBeNull()
  })

  it('treats the right and bottom edges as outside', () => {
    expect(zoneAt(map, 159.9, 100)?.id).toBe('room')
    expect(zoneAt(map, 160, 100)).toBeNull()
  })

  it('breaks priority ties by the smaller area, whatever the order', () => {
    const big = zone('big', 0, 0, 100, 100)
    const small = zone('small', 10, 10, 20, 20)
    expect(zoneAt({ zones: [big, small] }, 15, 15)?.id).toBe('small')
    expect(zoneAt({ zones: [small, big] }, 15, 15)?.id).toBe('small')
  })

  it('lets priority win over area', () => {
    const big = zone('big', 0, 0, 100, 100, 2)
    const small = zone('small', 10, 10, 20, 20, 1)
    expect(zoneAt({ zones: [small, big] }, 15, 15)?.id).toBe('big')
  })
})

describe('ZoneTracker', () => {
  // Two touching zones of equal priority: a = [0, 100), b = [100, 200).
  const pair = { zones: [zone('a', 0, 0, 100, 100), zone('b', 100, 0, 100, 100)] }

  it('commits the first position at once', () => {
    const tracker = new ZoneTracker(pair)
    expect(tracker.update(50, 50, 0)).toEqual({ zoneId: 'a', changed: true })
    expect(tracker.update(55, 50, 16)).toEqual({ zoneId: 'a', changed: false })
    expect(tracker.zoneId).toBe('a')
  })

  it('reports no change for a first position outside every zone', () => {
    expect(new ZoneTracker(pair).update(500, 50, 0)).toEqual({ zoneId: null, changed: false })
  })

  it('does not flap while the point jitters within the exit margin', () => {
    const tracker = new ZoneTracker(pair, { dwellMs: 0 })
    tracker.update(90, 50, 0)
    for (const x of [95, 105, 98, 111, 100, 112, 99, 110]) {
      expect(tracker.update(x, 50, x)).toEqual({ zoneId: 'a', changed: false })
    }
    expect(tracker.update(113, 50, 200)).toEqual({ zoneId: 'b', changed: true })
    for (const x of [99, 95, 105, 88]) {
      expect(tracker.update(x, 50, 300 + x)).toEqual({ zoneId: 'b', changed: false })
    }
    expect(tracker.update(87, 50, 500)).toEqual({ zoneId: 'a', changed: true })
  })

  it('waits for the dwell time before it commits a change', () => {
    const tracker = new ZoneTracker(pair)
    tracker.update(50, 50, 0)
    expect(tracker.update(150, 50, 1000).changed).toBe(false)
    expect(tracker.update(150, 50, 1100).changed).toBe(false)
    expect(tracker.update(151, 50, 1199)).toEqual({ zoneId: 'a', changed: false })
    expect(tracker.update(152, 50, 1200)).toEqual({ zoneId: 'b', changed: true })
  })

  it('restarts the dwell when the point goes back before the change commits', () => {
    const tracker = new ZoneTracker(pair)
    tracker.update(50, 50, 0)
    tracker.update(150, 50, 10)
    expect(tracker.update(50, 50, 100).changed).toBe(false)
    tracker.update(150, 50, 150)
    expect(tracker.update(150, 50, 300).changed).toBe(false)
    expect(tracker.update(150, 50, 350)).toEqual({ zoneId: 'b', changed: true })
  })

  it('commits at once with dwell 0 (server mode)', () => {
    const tracker = new ZoneTracker(pair, { dwellMs: 0 })
    tracker.update(50, 50, 0)
    expect(tracker.update(150, 50, 0)).toEqual({ zoneId: 'b', changed: true })
  })

  it('enters a nested zone with a higher priority at once and leaves it only past the margin', () => {
    const tracker = new ZoneTracker(map, { dwellMs: 0 })
    expect(tracker.update(240, 112, 0).zoneId).toBe('open')
    // The desk zone starts at y = 128.
    expect(tracker.update(240, 129, 10)).toEqual({ zoneId: 'desk', changed: true })
    expect(tracker.update(240, 117, 20)).toEqual({ zoneId: 'desk', changed: false })
    expect(tracker.update(240, 115, 30)).toEqual({ zoneId: 'open', changed: true })
  })

  it('leaves a zone for "no zone" only past the margin', () => {
    const tracker = new ZoneTracker(map, { dwellMs: 0 })
    tracker.update(150, 112, 0)
    // The room ends at x = 160; the door cell (5,3) is in no zone.
    expect(tracker.update(171, 112, 10)).toEqual({ zoneId: 'room', changed: false })
    expect(tracker.update(173, 112, 20)).toEqual({ zoneId: null, changed: true })
  })

  it('commits at once after reset', () => {
    const tracker = new ZoneTracker(pair)
    tracker.update(50, 50, 0)
    tracker.reset()
    expect(tracker.zoneId).toBeNull()
    expect(tracker.update(150, 50, 5)).toEqual({ zoneId: 'b', changed: true })
  })
})
