import Phaser from 'phaser'
import type { PlayerState } from '@vo/shared'
import { AvatarView, type AvatarPose } from '../avatar/AvatarView.ts'
import { EventBus } from '../EventBus.ts'
import { InterpolationBuffer } from './interpolation.ts'

// Another player: drawn INTERPOLATION_DELAY_MS in the past between the positions the server sent. A click on it
// opens the profile card.
export class RemoteAvatar {
  private readonly view: AvatarView
  private readonly buffer = new InterpolationBuffer()
  private readonly state: PlayerState

  constructor(scene: Phaser.Scene, state: PlayerState, now: number) {
    this.state = state
    this.view = new AvatarView(scene, state, state.dir, (key, frame) => scene.add.sprite(state.x, state.y, key, frame))
    this.view.sprite
      .setInteractive({ useHandCursor: true })
      .on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, () => EventBus.emit('profile-open', state.userId))
    this.onServerChange(now)
  }

  get sprite(): Phaser.GameObjects.Sprite {
    return this.view.sprite
  }

  // What is drawn now (tests and window.__voOffice read it).
  get rendered(): { x: number; y: number; dir: string; pose: AvatarPose } {
    return { x: this.view.sprite.x, y: this.view.sprite.y, dir: this.view.facing, pose: this.view.pose }
  }

  onServerChange(now: number): void {
    const { x, y, dir, moving, seatId } = this.state
    this.buffer.push({ t: now, x, y, dir, moving, seated: seatId !== '' })
    this.view.setLook(this.state)
  }

  update(now: number): void {
    const pose = this.buffer.sample(now)
    if (!pose) return
    this.view.sprite.setPosition(pose.x, pose.y)
    this.view.setPose(pose.dir, pose.moving, pose.seated)
    this.view.sync()
  }

  destroy(): void {
    this.view.destroy()
  }
}
