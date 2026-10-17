import type Phaser from 'phaser'
import type { PlayerState } from '@vo/shared'
import { AvatarView } from '../avatar/AvatarView.ts'
import { InterpolationBuffer } from './interpolation.ts'

// Another player: drawn INTERPOLATION_DELAY_MS in the past between the positions the server sent.
export class RemoteAvatar {
  private readonly view: AvatarView
  private readonly buffer = new InterpolationBuffer()
  private readonly state: PlayerState

  constructor(scene: Phaser.Scene, state: PlayerState, now: number) {
    this.state = state
    this.view = new AvatarView(scene, state, state.dir, (key, frame) => scene.add.sprite(state.x, state.y, key, frame))
    this.onServerChange(now)
  }

  get sprite(): Phaser.GameObjects.Sprite {
    return this.view.sprite
  }

  onServerChange(now: number): void {
    const { x, y, dir, moving } = this.state
    this.buffer.push({ t: now, x, y, dir, moving })
    this.view.setLook(this.state)
  }

  update(now: number): void {
    const pose = this.buffer.sample(now)
    if (!pose) return
    this.view.sprite.setPosition(pose.x, pose.y)
    this.view.setPose(pose.dir, pose.moving)
    this.view.sync()
  }

  destroy(): void {
    this.view.destroy()
  }
}
