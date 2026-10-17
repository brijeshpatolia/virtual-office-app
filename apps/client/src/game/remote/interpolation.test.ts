import { describe, expect, it } from 'vitest'
import { INTERPOLATION_DELAY_MS, InterpolationBuffer, TELEPORT_PX, type Snapshot } from './interpolation.ts'

const snap = (t: number, x: number, moving = true): Snapshot => ({ t, x, y: 50, dir: 'right', moving })

describe('InterpolationBuffer', () => {
  it('returns null before the first snapshot and the first snapshot until there is a newer one', () => {
    const buffer = new InterpolationBuffer()
    expect(buffer.sample(0)).toBeNull()
    buffer.push(snap(1_000, 10, false))
    expect(buffer.sample(1_000)).toEqual({ x: 10, y: 50, dir: 'right', moving: false })
    expect(buffer.sample(5_000)).toMatchObject({ x: 10 })
  })

  it('draws INTERPOLATION_DELAY_MS in the past, interpolating linearly', () => {
    const buffer = new InterpolationBuffer()
    buffer.push(snap(1_000, 0))
    buffer.push(snap(1_100, 16))
    expect(buffer.sample(1_100)?.x).toBe(0)
    expect(buffer.sample(1_000 + INTERPOLATION_DELAY_MS + 50)?.x).toBeCloseTo(8)
    expect(buffer.sample(1_200)?.x).toBe(16)
  })

  it('waits at the newest position instead of extrapolating', () => {
    const buffer = new InterpolationBuffer()
    buffer.push(snap(0, 0))
    buffer.push(snap(100, 16, false))
    expect(buffer.sample(10_000)).toMatchObject({ x: 16, moving: false })
  })

  it('keeps walking until the stop position is reached', () => {
    const buffer = new InterpolationBuffer()
    buffer.push(snap(0, 0, true))
    buffer.push(snap(100, 16, false))
    expect(buffer.sample(150)?.moving).toBe(true)
    expect(buffer.sample(200)?.moving).toBe(false)
  })

  it('jumps at once on a teleport', () => {
    const buffer = new InterpolationBuffer()
    buffer.push(snap(0, 0))
    buffer.push(snap(100, 16))
    buffer.push(snap(200, 16 + TELEPORT_PX + 1, false))
    expect(buffer.size).toBe(1)
    expect(buffer.sample(200)?.x).toBe(16 + TELEPORT_PX + 1)
  })

  it('drops old snapshots as time passes', () => {
    const buffer = new InterpolationBuffer()
    for (let i = 0; i < 10; i++) buffer.push(snap(i * 100, i * 16))
    buffer.sample(900 + INTERPOLATION_DELAY_MS)
    expect(buffer.size).toBe(1)
  })
})
