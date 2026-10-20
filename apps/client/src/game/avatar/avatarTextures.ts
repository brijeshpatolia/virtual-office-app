import type Phaser from 'phaser'
import type { Facing } from '@vo/shared'
import { AVATAR_COLUMNS, AVATAR_FRAME, AVATAR_ROWS, avatarFrameIndex, renderAvatarSheet, SIT_COLUMN, WALK_CYCLE } from './avatarArt.ts'

// Turns the generated avatar art into one spritesheet texture per colour, with a walk animation per direction.
// The only module that knows where avatar pixels come from: swap it (and avatarArt.ts) for a real sheet later.

const WALK_FPS = 8

export const avatarTextureKey = (color: string): string => `avatar:${color.toLowerCase()}`
export const walkAnimKey = (textureKey: string, dir: Facing): string => `${textureKey}:walk:${dir}`
export const idleFrame = (dir: Facing): number => avatarFrameIndex(dir, 0)
export const sitFrame = (dir: Facing): number => avatarFrameIndex(dir, SIT_COLUMN)

export function ensureAvatarTexture(scene: Phaser.Scene, color: string): string {
  const key = avatarTextureKey(color)
  if (scene.textures.exists(key)) return key
  const sheet = renderAvatarSheet(color)
  const texture = scene.textures.createCanvas(key, sheet.width, sheet.height)
  if (!texture) throw new Error(`Could not create the avatar texture ${key}`)
  texture.context.putImageData(new ImageData(sheet.data, sheet.width, sheet.height), 0, 0)
  AVATAR_ROWS.forEach((_dir, row) => {
    for (let column = 0; column < AVATAR_COLUMNS; column++) {
      const { width, height } = AVATAR_FRAME
      texture.add(row * AVATAR_COLUMNS + column, 0, column * width, row * height, width, height)
    }
  })
  texture.refresh()
  for (const dir of AVATAR_ROWS) {
    scene.anims.create({
      key: walkAnimKey(key, dir),
      frames: WALK_CYCLE.map((column) => ({ key, frame: avatarFrameIndex(dir, column) })),
      frameRate: WALK_FPS,
      repeat: -1,
    })
  }
  return key
}
