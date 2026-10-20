import { describe, expect, it } from 'vitest'
import { INTERPOLATION_DELAY_MS, InterpolationBuffer, TELEPORT_PX, type Snapshot } from './interpolation.ts'

const snap = (t: number, x: number, moving = true, seated = false): Snapshot => ({ t, x, y: 50, dir: 'right', moving, seated })

describe('InterpolationBuffer', () => {
  it('returns null before the first snapshot and the first snapshot until there is a newer one', () => {
    const buffer = new InterpolationBuffer()
    expect(buffer.sample(0)).toBeNull()
    buffer.push(snap(1_000, 10, false))
    expect(buffer.sample(1_000)).toEqual({ x: 10, y: 50, dir: 'right', moving: false, seated: false })
    expect(buffer.sample(5_000)).toMatchObject({ x: 10 })
  })

  it('draws INTERPOLATION_DELAY_MS (two patches) in the past, interpolating linearly', () => {
    expect(INTERPOLATION_DELAY_MS).toBe(200)
    const buffer = new InterpolationBuffer()
    buffer.push(snap(1_000, 0))
    buffer.push(snap(1_100, 16))
    expect(buffer.sample(1_100)?.x).toBe(0)
    expect(buffer.sample(1_000 + INTERPOLATION_DELAY_MS + 50)?.x).toBeCloseTo(8)
    expect(buffer.sample(1_100 + INTERPOLATION_DELAY_MS)?.x).toBe(16)
  })

  it('keeps a remote walker moving smoothly when a patch interval brings no move', () => {
    // Moves every 110 ms at 160 px/s, patches every 100 ms: some patches are empty.
    const buffer = new InterpolationBuffer()
    let lastX: number | null = null
    let largestStep = 0
    let frozen = 0
    for (let t = 0, nextMove = 0; t <= 5_000; t += 100) {
      if (t >= nextMove) {
        buffer.push(snap(t, (nextMove / 1000) * 160))
        nextMove += 110
      }
      for (const offset of [0, 17, 33, 50, 67, 83]) {
        const frame = t + offset
        if (frame < 1_000) continue
        const px = buffer.sample(frame)?.x ?? 0
        if (lastX !== null) {
          largestStep = Math.max(largestStep, px - lastX)
          if (px === lastX) frozen++
        }
        lastX = px
      }
    }
    expect(frozen).toBe(0)
    expect(largestStep).toBeLessThan(4)
  })

  it('shows a remote avatar seated once it reaches the seat, and standing at once', () => {
    const buffer = new InterpolationBuffer()
    buffer.push(snap(0, 0, true))
    buffer.push(snap(100, 30, false, true))
    expect(buffer.sample(250)).toMatchObject({ seated: false })
    expect(buffer.sample(300)).toMatchObject({ x: 30, seated: true })
    buffer.push(snap(400, 30, false, false))
    expect(buffer.sample(600)).toMatchObject({ seated: false })
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
    expect(buffer.sample(50 + INTERPOLATION_DELAY_MS)?.moving).toBe(true)
    expect(buffer.sample(100 + INTERPOLATION_DELAY_MS)?.moving).toBe(false)
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
