import { MAX_SPEED, type Facing } from '@vo/shared'

export interface DirectionInput {
  up: boolean
  down: boolean
  left: boolean
  right: boolean
}

export interface Velocity {
  vx: number
  vy: number
}

export const NO_INPUT: DirectionInput = { up: false, down: false, left: false, right: false }

// Opposite keys cancel out; a diagonal has the same speed as a straight move.
export function inputVelocity(input: DirectionInput, speed: number = MAX_SPEED): Velocity {
  const x = Number(input.right) - Number(input.left)
  const y = Number(input.down) - Number(input.up)
  if (x === 0 && y === 0) return { vx: 0, vy: 0 }
  const scale = x !== 0 && y !== 0 ? speed / Math.SQRT2 : speed
  return { vx: x * scale, vy: y * scale }
}

// Straight moves face their direction. A diagonal keeps the current facing when it is one of its two
// directions (so a turn does not flicker), else it faces sideways.
export function facingFor({ vx, vy }: Velocity, previous: Facing): Facing {
  const horizontal: Facing | null = vx < 0 ? 'left' : vx > 0 ? 'right' : null
  const vertical: Facing | null = vy < 0 ? 'up' : vy > 0 ? 'down' : null
  if (horizontal && vertical) return previous === horizontal || previous === vertical ? previous : horizontal
  return horizontal ?? vertical ?? previous
}
