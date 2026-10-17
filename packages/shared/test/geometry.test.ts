import { describe, expect, it } from 'vitest'
import { distance, distanceToRect, feetPoint, rectContains, rectInside, rectsOverlap } from '../src/geometry.ts'

const rect = { x: 32, y: 64, w: 32, h: 32 }

describe('geometry', () => {
  it('rectContains is half-open, so adjacent rects never share a point', () => {
    expect(rectContains(rect, 32, 64)).toBe(true)
    expect(rectContains(rect, 63.9, 95.9)).toBe(true)
    expect(rectContains(rect, 64, 70)).toBe(false)
    expect(rectContains(rect, 40, 96)).toBe(false)
    expect(rectContains({ x: 64, y: 64, w: 32, h: 32 }, 64, 70)).toBe(true)
  })

  it('distanceToRect is 0 inside and Euclidean outside', () => {
    expect(distanceToRect(rect, 40, 70)).toBe(0)
    expect(distanceToRect(rect, 76, 70)).toBe(12)
    expect(distanceToRect(rect, 20, 70)).toBe(12)
    expect(distanceToRect(rect, 67, 100)).toBe(5)
  })

  it('distance and feetPoint', () => {
    expect(distance(0, 0, 3, 4)).toBe(5)
    expect(feetPoint(100, 200)).toEqual({ x: 100, y: 212 })
  })

  it('overlap ignores touching edges; inside allows shared edges', () => {
    expect(rectsOverlap(rect, { x: 64, y: 64, w: 10, h: 10 })).toBe(false)
    expect(rectsOverlap(rect, { x: 63, y: 64, w: 10, h: 10 })).toBe(true)
    expect(rectInside({ x: 48, y: 64, w: 16, h: 32 }, rect)).toBe(true)
    expect(rectInside({ x: 48, y: 64, w: 17, h: 32 }, rect)).toBe(false)
  })
})
