import { FEET_OFFSET_Y } from './constants.ts'
import type { Point, Rect } from './types.ts'

// Half-open: a point on the right or bottom edge belongs to the next rect, so adjacent rects never share a point.
export function rectContains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h
}

export function rectArea(rect: Rect): number {
  return rect.w * rect.h
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

export function rectInside(inner: Rect, outer: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  )
}

export function rectsEqual(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
}

export function distance(x0: number, y0: number, x1: number, y1: number): number {
  return Math.hypot(x1 - x0, y1 - y0)
}

// 0 inside the rect, otherwise the Euclidean distance to its nearest edge.
export function distanceToRect(rect: Rect, x: number, y: number): number {
  const dx = Math.max(rect.x - x, 0, x - (rect.x + rect.w))
  const dy = Math.max(rect.y - y, 0, y - (rect.y + rect.h))
  return Math.hypot(dx, dy)
}

// The avatar's position is its sprite centre; zones and collisions use the point under its feet.
export function feetPoint(x: number, y: number): Point {
  return { x, y: y + FEET_OFFSET_Y }
}
