import { describe, expect, it } from 'vitest'
import { MOVE_INTERVAL_MS } from '@vo/shared'
import { MIN_SEND_GAP_MS, MoveSender, type MoveSample } from './moveSender.ts'

const at = (x: number, y = 100, moving = true, dir: MoveSample['dir'] = 'right'): MoveSample => ({ x, y, dir, moving })

describe('MoveSender', () => {
  it('sends a start at once, then at most every MOVE_INTERVAL_MS while moving', () => {
    const sender = new MoveSender(at(0, 100, false))
    expect(sender.update(0, at(1))).toMatchObject({ x: 1, moving: true, seq: 1 })
    expect(sender.update(16, at(3))).toBeNull()
    expect(sender.update(MOVE_INTERVAL_MS - 1, at(15))).toBeNull()
    expect(sender.update(MOVE_INTERVAL_MS, at(16))).toMatchObject({ x: 16, seq: 2 })
  })

  it('sends a stop and a turn at once, but keeps MIN_SEND_GAP_MS between moves', () => {
    const sender = new MoveSender(at(0, 100, false))
    sender.update(0, at(1))
    expect(sender.update(MIN_SEND_GAP_MS - 1, at(5, 100, false))).toBeNull()
    expect(sender.update(MIN_SEND_GAP_MS, at(6, 100, false))).toMatchObject({ x: 6, moving: false, seq: 2 })
    expect(sender.update(2 * MIN_SEND_GAP_MS, at(6, 100, true, 'down'))).toMatchObject({ dir: 'down', seq: 3 })
    expect(sender.update(3 * MIN_SEND_GAP_MS, at(6, 108, true, 'left'))).toMatchObject({ dir: 'left', seq: 4 })
  })

  it('sends nothing while standing still', () => {
    const sender = new MoveSender(at(5, 100, false))
    expect(sender.update(1_000, at(5, 100, false))).toBeNull()
    expect(sender.update(5_000, at(5, 100, false))).toBeNull()
  })

  it('force sends a pending stop inside the gap', () => {
    const sender = new MoveSender(at(0, 100, false))
    sender.update(0, at(1))
    expect(sender.update(10, at(2, 100, false), true)).toMatchObject({ x: 2, moving: false, seq: 2 })
  })

  it('applies a reject once and ignores rejects of moves sent before the snap', () => {
    const sender = new MoveSender(at(0, 100, false))
    for (let t = 0, x = 1; t <= 300; t += MOVE_INTERVAL_MS, x += 16) sender.update(t, at(x))
    expect(sender.lastSeq).toBe(4)
    expect(sender.shouldApplyReject(2)).toBe(true)
    sender.reset(at(1, 100, false))
    expect(sender.shouldApplyReject(3)).toBe(false)
    expect(sender.shouldApplyReject(4)).toBe(false)
    const next = sender.update(1_000, at(2))
    expect(next?.seq).toBe(5)
    expect(sender.shouldApplyReject(5)).toBe(true)
    expect(sender.shouldApplyReject(99)).toBe(false)
  })
})
