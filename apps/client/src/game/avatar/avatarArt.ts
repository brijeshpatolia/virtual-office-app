import type { Facing } from '@vo/shared'

// Placeholder avatar art, drawn by code: a small pixel person in the player's colour. Pure (no Phaser, no DOM),
// so it is testable; avatarTextures.ts turns the pixels into a Phaser spritesheet. A real character sheet
// (e.g. LimeZu) replaces this module and keeps the same frame layout API.

export const AVATAR_FRAME = { width: 32, height: 48 } as const
// Sheet rows, top to bottom.
export const AVATAR_ROWS: readonly Facing[] = ['down', 'left', 'right', 'up']
// Columns: 0 idle, 1-3 walk.
export const AVATAR_COLUMNS = 4
export const WALK_CYCLE = [1, 2, 3, 2] as const
// The lowest drawn row of a frame (shoe outline): the bottom of the 20x12 body box, 18 px below the centre.
export const AVATAR_FEET_ROW = 42

export function avatarFrameIndex(dir: Facing, column: number): number {
  return AVATAR_ROWS.indexOf(dir) * AVATAR_COLUMNS + column
}

export interface PixelSheet {
  width: number
  height: number
  // RGBA, row by row.
  data: Uint8ClampedArray<ArrayBuffer>
}

type Rgba = readonly [number, number, number, number]

// Palette index ("ink") of each frame pixel; the shirt inks take the player's colour.
const C = {
  clear: 0,
  outline: 1,
  skin: 2,
  skinShade: 3,
  hair: 4,
  hairLight: 5,
  shirt: 6,
  shirtShade: 7,
  pants: 8,
  shoes: 9,
  eye: 10,
} as const
type Ink = (typeof C)[keyof typeof C]

const FIXED: Record<Exclude<Ink, typeof C.clear | typeof C.shirt | typeof C.shirtShade>, Rgba> = {
  [C.outline]: [31, 27, 46, 255],
  [C.skin]: [242, 199, 154, 255],
  [C.skinShade]: [217, 162, 115, 255],
  [C.hair]: [74, 48, 32, 255],
  [C.hairLight]: [107, 74, 51, 255],
  [C.pants]: [58, 68, 102, 255],
  [C.shoes]: [38, 43, 68, 255],
  [C.eye]: [31, 27, 46, 255],
}
const SHADOW: Rgba = [0, 0, 0, 72]

export function parseHexColor(hex: string): Rgba {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  const n = m ? Number.parseInt(m[1] as string, 16) : 0x808080
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255]
}

class Frame {
  readonly ink = new Uint8Array(AVATAR_FRAME.width * AVATAR_FRAME.height)

  rect(x: number, y: number, w: number, h: number, ink: Ink): void {
    for (let row = y; row < y + h; row++) {
      for (let col = x; col < x + w; col++) this.set(col, row, ink)
    }
  }

  set(x: number, y: number, ink: Ink): void {
    if (x < 0 || y < 0 || x >= AVATAR_FRAME.width || y >= AVATAR_FRAME.height) return
    this.ink[y * AVATAR_FRAME.width + x] = ink
  }

  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= AVATAR_FRAME.width || y >= AVATAR_FRAME.height) return C.clear
    return this.ink[y * AVATAR_FRAME.width + x] ?? C.clear
  }

  mirrored(): Frame {
    const out = new Frame()
    const { width, height } = AVATAR_FRAME
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) out.set(width - 1 - x, y, this.get(x, y) as Ink)
    return out
  }

  // A 1 px outline around everything drawn so far.
  outline(): void {
    const { width, height } = AVATAR_FRAME
    const edge: number[] = []
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (this.get(x, y) !== C.clear) continue
        if (this.get(x - 1, y) || this.get(x + 1, y) || this.get(x, y - 1) || this.get(x, y + 1)) edge.push(y * width + x)
      }
    }
    for (const i of edge) this.ink[i] = C.outline
  }
}

// Leg and arm offsets of a walk column: 1 and 3 are the two strides, 2 passes the legs.
function stride(column: number): -1 | 0 | 1 {
  return column === 1 ? 1 : column === 3 ? -1 : 0
}

function drawFront(f: Frame, column: number, back: boolean): void {
  const s = stride(column)
  const bob = s === 0 ? 0 : 1
  // Legs (not bobbed). A forward leg reaches one row lower, the other foot is lifted.
  for (const [x, lift] of [
    [11, -s],
    [17, s],
  ] as const) {
    f.rect(x, 34, 4, 6 + lift, C.pants)
    f.rect(x, 40 + lift, 4, 2, C.shoes)
  }
  // Arms swing against the legs.
  for (const [x, swing] of [
    [8, s],
    [22, -s],
  ] as const) {
    f.rect(x, 24 + bob + swing, 2, 8, C.shirtShade)
    f.rect(x, 32 + bob + swing, 2, 2, C.skin)
  }
  f.rect(10, 23 + bob, 12, 11, C.shirt)
  f.rect(10, 33 + bob, 12, 1, C.shirtShade)
  // Head with cut corners.
  f.rect(10, 8 + bob, 12, 14, C.skin)
  f.rect(11, 21 + bob, 10, 1, C.skinShade)
  f.rect(10, 7 + bob, 12, 4, C.hair)
  f.rect(13, 8 + bob, 4, 1, C.hairLight)
  for (const x of [10, 21]) {
    f.set(x, 7 + bob, C.clear)
    f.set(x, 21 + bob, C.clear)
  }
  if (back) {
    f.rect(10, 11 + bob, 12, 9, C.hair)
    f.rect(12, 10 + bob, 6, 1, C.hairLight)
    return
  }
  f.rect(14, 23 + bob, 4, 1, C.skinShade)
  f.rect(10, 11 + bob, 2, 5, C.hair)
  f.rect(20, 11 + bob, 2, 5, C.hair)
  f.rect(12, 11 + bob, 3, 1, C.hair)
  f.rect(17, 11 + bob, 2, 1, C.hair)
  f.rect(13, 15 + bob, 2, 3, C.eye)
  f.rect(17, 15 + bob, 2, 3, C.eye)
  f.rect(15, 19 + bob, 2, 1, C.skinShade)
}

// Facing left. The right frames are mirror images.
function drawSide(f: Frame, column: number): void {
  const s = stride(column)
  const bob = s === 0 ? 0 : 1
  // Back leg first, so the front leg covers it. A leg reaches forward (left) or back by 3 px at the foot.
  const legs: Array<[hip: number, reach: number]> = s === 0 ? [[14, 0]] : [
    [15, 3 * s],
    [14, -3 * s],
  ]
  for (const [hip, reach] of legs) {
    f.rect(hip, 34, 3, 2, C.pants)
    f.rect(hip + Math.trunc(reach / 2), 36, 3, 2, C.pants)
    f.rect(hip + reach, 38, 3, 2, C.pants)
    f.rect(hip + reach - 1, 40, 4, 2, C.shoes)
  }
  f.rect(17 + s, 24 + bob, 2, 8, C.shirtShade)
  f.rect(12, 23 + bob, 8, 11, C.shirt)
  f.rect(12, 33 + bob, 8, 1, C.shirtShade)
  f.rect(14 - 2 * s, 24 + bob, 3, 8, C.shirt)
  f.rect(14 - 2 * s, 32 + bob, 3, 2, C.skin)
  f.rect(10, 8 + bob, 12, 14, C.skin)
  f.rect(11, 21 + bob, 10, 1, C.skinShade)
  f.set(9, 17 + bob, C.skin)
  f.rect(10, 7 + bob, 12, 4, C.hair)
  f.rect(16, 11 + bob, 6, 7, C.hair)
  f.rect(10, 11 + bob, 3, 1, C.hair)
  f.rect(13, 8 + bob, 4, 1, C.hairLight)
  f.rect(17, 14 + bob, 2, 3, C.skinShade)
  for (const x of [10, 21]) {
    f.set(x, 7 + bob, C.clear)
    f.set(x, 21 + bob, C.clear)
  }
  f.rect(12, 15 + bob, 2, 3, C.eye)
  f.set(11, 20 + bob, C.skinShade)
}

function drawFrame(dir: Facing, column: number): Frame {
  const f = new Frame()
  if (dir === 'down' || dir === 'up') drawFront(f, column, dir === 'up')
  else drawSide(f, column)
  f.outline()
  return dir === 'right' ? f.mirrored() : f
}

function inShadow(x: number, y: number): boolean {
  const dx = (x + 0.5 - AVATAR_FRAME.width / 2) / 8
  const dy = (y + 0.5 - (AVATAR_FEET_ROW - 0.5)) / 2.2
  return dx * dx + dy * dy <= 1
}

// The whole sheet: AVATAR_COLUMNS x AVATAR_ROWS frames of AVATAR_FRAME, shirt in `shirtColor` ('#rrggbb').
export function renderAvatarSheet(shirtColor: string): PixelSheet {
  const shirt = parseHexColor(shirtColor)
  const shade: Rgba = [Math.round(shirt[0] * 0.72), Math.round(shirt[1] * 0.72), Math.round(shirt[2] * 0.72), 255]
  const colors = (ink: number): Rgba | null => (ink === C.clear ? null : ink === C.shirt ? shirt : ink === C.shirtShade ? shade : FIXED[ink as keyof typeof FIXED])
  const { width: fw, height: fh } = AVATAR_FRAME
  const width = fw * AVATAR_COLUMNS
  const height = fh * AVATAR_ROWS.length
  const data = new Uint8ClampedArray(width * height * 4)
  AVATAR_ROWS.forEach((dir, row) => {
    for (let column = 0; column < AVATAR_COLUMNS; column++) {
      const frame = drawFrame(dir, column)
      for (let y = 0; y < fh; y++) {
        for (let x = 0; x < fw; x++) {
          const rgba = colors(frame.get(x, y)) ?? (inShadow(x, y) ? SHADOW : null)
          if (!rgba) continue
          data.set(rgba, ((row * fh + y) * width + column * fw + x) * 4)
        }
      }
    }
  })
  return { width, height, data }
}
