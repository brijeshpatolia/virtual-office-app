import { describe, expect, it } from 'vitest'
import { PLAYER_BODY } from '@vo/shared'
import { AVATAR_COLUMNS, AVATAR_FEET_ROW, AVATAR_FRAME, AVATAR_ROWS, avatarFrameIndex, parseHexColor, renderAvatarSheet } from './avatarArt.ts'

const sheet = renderAvatarSheet('#4363d8')

function framePixels(row: number, column: number): number[][] {
  const out: number[][] = []
  for (let y = 0; y < AVATAR_FRAME.height; y++) {
    for (let x = 0; x < AVATAR_FRAME.width; x++) {
      const i = ((row * AVATAR_FRAME.height + y) * sheet.width + column * AVATAR_FRAME.width + x) * 4
      out.push([x, y, ...sheet.data.slice(i, i + 4)])
    }
  }
  return out
}
const opaque = (pixels: number[][]) => pixels.filter((p) => p[5] === 255)

describe('renderAvatarSheet', () => {
  it('lays out 4 directions x (idle + 3 walk frames) of 32x48', () => {
    expect(sheet.width).toBe(AVATAR_FRAME.width * AVATAR_COLUMNS)
    expect(sheet.height).toBe(AVATAR_FRAME.height * AVATAR_ROWS.length)
    expect(sheet.data.length).toBe(sheet.width * sheet.height * 4)
    expect(avatarFrameIndex('down', 0)).toBe(0)
    expect(avatarFrameIndex('up', 3)).toBe(15)
  })

  it('puts the feet at the bottom of the physics body', () => {
    const idle = opaque(framePixels(0, 0))
    const bottom = Math.max(...idle.map((p) => p[1] as number))
    expect(bottom).toBe(AVATAR_FEET_ROW)
    expect(AVATAR_FEET_ROW - AVATAR_FRAME.height / 2).toBe(PLAYER_BODY.offsetY + PLAYER_BODY.h / 2)
  })

  it('draws the shirt in the player colour', () => {
    const [r, g, b] = parseHexColor('#4363d8')
    expect(opaque(framePixels(0, 0)).some((p) => p[2] === r && p[3] === g && p[4] === b)).toBe(true)
  })

  it('animates the walk and mirrors left into right', () => {
    const key = (pixels: number[][]) => pixels.map((p) => p.slice(2).join(',')).join(';')
    for (let row = 0; row < AVATAR_ROWS.length; row++) {
      expect(key(framePixels(row, 1))).not.toBe(key(framePixels(row, 2)))
      expect(key(framePixels(row, 1))).not.toBe(key(framePixels(row, 3)))
    }
    const left = framePixels(AVATAR_ROWS.indexOf('left'), 1)
    const right = framePixels(AVATAR_ROWS.indexOf('right'), 1)
    for (const [x, y, ...rgba] of left) {
      const mirrored = right[(y as number) * AVATAR_FRAME.width + (AVATAR_FRAME.width - 1 - (x as number))]
      expect(mirrored?.slice(2)).toEqual(rgba)
    }
  })

  it('falls back to grey for a bad colour', () => {
    expect(parseHexColor('nope')).toEqual([128, 128, 128, 255])
    expect(parseHexColor('#E6194B')).toEqual([230, 25, 75, 255])
  })
})
