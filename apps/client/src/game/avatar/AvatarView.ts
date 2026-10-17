import Phaser from 'phaser'
import type { Facing, PlayerStatus } from '@vo/shared'
import { avatarDepth, DEPTH } from '../depth.ts'
import { AVATAR_FRAME } from './avatarArt.ts'
import { ensureAvatarTexture, idleFrame, walkAnimKey } from './avatarTextures.ts'

export interface AvatarLook {
  name: string
  color: string
  status: PlayerStatus
}

const STATUS_COLOR: Record<PlayerStatus, number> = { available: 0x3ccf6e, away: 0xf2a33a }
// The name tag sits just above the hair (frame row 7).
const TAG_Y = -AVATAR_FRAME.height / 2 + 5
const TAG_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  fontSize: '10px',
  color: '#ffffff',
  backgroundColor: 'rgba(20, 24, 32, 0.72)',
  padding: { left: 11, right: 4, top: 1, bottom: 1 },
  resolution: 3,
}

const copyLook = ({ name, color, status }: AvatarLook): AvatarLook => ({ name, color, status })

export type SpriteFactory = (textureKey: string, frame: number) => Phaser.GameObjects.Sprite

// One avatar on the map: the sprite, a name tag and a status dot. Position the sprite, then call sync().
export class AvatarView {
  readonly sprite: Phaser.GameObjects.Sprite
  private readonly tag: Phaser.GameObjects.Text
  private readonly dot: Phaser.GameObjects.Arc
  private textureKey: string
  private look: AvatarLook
  private dir: Facing
  private moving = false

  constructor(scene: Phaser.Scene, look: AvatarLook, dir: Facing, makeSprite: SpriteFactory) {
    this.look = copyLook(look)
    this.dir = dir
    this.textureKey = ensureAvatarTexture(scene, look.color)
    this.sprite = makeSprite(this.textureKey, idleFrame(dir))
    this.tag = scene.add.text(0, 0, look.name, TAG_STYLE).setOrigin(0.5, 1).setDepth(DEPTH.labels)
    // The game uses nearest filtering for pixel art; text looks better smoothed.
    this.tag.texture.setFilter(Phaser.Textures.FilterMode.LINEAR)
    this.dot = scene.add.circle(0, 0, 2.5, STATUS_COLOR[look.status]).setStrokeStyle(1, 0x000000, 0.6).setDepth(DEPTH.labels + 1)
    this.sync()
  }

  get facing(): Facing {
    return this.dir
  }

  setLook(look: AvatarLook): void {
    if (look.color !== this.look.color) {
      this.textureKey = ensureAvatarTexture(this.sprite.scene, look.color)
      this.sprite.setTexture(this.textureKey, idleFrame(this.dir))
      this.applyPose(true)
    }
    if (look.name !== this.look.name) this.tag.setText(look.name)
    if (look.status !== this.look.status) this.dot.setFillStyle(STATUS_COLOR[look.status])
    // The look may be a live state object, so keep a copy to compare with.
    this.look = copyLook(look)
  }

  setPose(dir: Facing, moving: boolean): void {
    if (dir === this.dir && moving === this.moving) return
    this.dir = dir
    this.moving = moving
    this.applyPose(false)
  }

  // Name tag, dot and draw order follow the sprite.
  sync(): void {
    const { x, y } = this.sprite
    this.sprite.setDepth(avatarDepth(y))
    this.tag.setPosition(x, y + TAG_Y)
    this.dot.setPosition(x - this.tag.width / 2 + 6, y + TAG_Y - this.tag.height / 2)
  }

  destroy(): void {
    this.sprite.destroy()
    this.tag.destroy()
    this.dot.destroy()
  }

  private applyPose(force: boolean): void {
    if (this.moving) {
      this.sprite.anims.play(walkAnimKey(this.textureKey, this.dir), !force)
    } else {
      this.sprite.anims.stop()
      this.sprite.setFrame(idleFrame(this.dir))
    }
  }
}
