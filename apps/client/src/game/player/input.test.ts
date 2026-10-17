import { describe, expect, it } from 'vitest'
import { MAX_SPEED } from '@vo/shared'
import { facingFor, inputVelocity, NO_INPUT } from './input.ts'

const keys = (pressed: string) => ({
  up: pressed.includes('u'),
  down: pressed.includes('d'),
  left: pressed.includes('l'),
  right: pressed.includes('r'),
})

describe('inputVelocity', () => {
  it('moves at MAX_SPEED in a straight line', () => {
    expect(inputVelocity(keys('r'))).toEqual({ vx: MAX_SPEED, vy: 0 })
    expect(inputVelocity(keys('u'))).toEqual({ vx: 0, vy: -MAX_SPEED })
  })

  it('normalises diagonals to the same speed', () => {
    const { vx, vy } = inputVelocity(keys('dl'))
    expect(vx).toBeLessThan(0)
    expect(vy).toBeGreaterThan(0)
    expect(Math.hypot(vx, vy)).toBeCloseTo(MAX_SPEED)
  })

  it('cancels opposite keys and stands still without input', () => {
    expect(inputVelocity(keys('lr'))).toEqual({ vx: 0, vy: 0 })
    expect(inputVelocity(keys('udr'))).toEqual({ vx: MAX_SPEED, vy: 0 })
    expect(inputVelocity(NO_INPUT)).toEqual({ vx: 0, vy: 0 })
  })
})

describe('facingFor', () => {
  it('faces the direction of a straight move and keeps facing when stopped', () => {
    expect(facingFor({ vx: -1, vy: 0 }, 'down')).toBe('left')
    expect(facingFor({ vx: 0, vy: 1 }, 'left')).toBe('down')
    expect(facingFor({ vx: 0, vy: 0 }, 'up')).toBe('up')
  })

  it('keeps a matching facing on a diagonal, else faces sideways', () => {
    expect(facingFor({ vx: 1, vy: -1 }, 'up')).toBe('up')
    expect(facingFor({ vx: 1, vy: -1 }, 'right')).toBe('right')
    expect(facingFor({ vx: 1, vy: -1 }, 'down')).toBe('right')
  })
})
