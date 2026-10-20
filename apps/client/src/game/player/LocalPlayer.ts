import Phaser from 'phaser'
import {
  MAX_SPEED,
  MOVE_INTERVAL_MS,
  PLAYER_BODY,
  rejectReason,
  type Facing,
  type MoveReject,
  type PlayerState,
  type Point,
  type SeatDef,
} from '@vo/shared'
import type { OfficeLink } from '../../net/officeLink.ts'
import { AVATAR_FRAME } from '../avatar/avatarArt.ts'
import { AvatarView } from '../avatar/AvatarView.ts'
import { EventBus } from '../EventBus.ts'
import { nearestFreeSeat, SEAT_HINT_RADIUS, seatHint, sitRejectText } from '../seats.ts'
import { EntryBlock, isEntryReject } from './entryBlock.ts'
import { facingFor, inputVelocity, NO_INPUT, type DirectionInput } from './input.ts'
import { MoveSender, type MoveSample } from './moveSender.ts'

export interface MovementKeys {
  up: Phaser.Input.Keyboard.Key[]
  down: Phaser.Input.Keyboard.Key[]
  left: Phaser.Input.Keyboard.Key[]
  right: Phaser.Input.Keyboard.Key[]
  interact: Phaser.Input.Keyboard.Key
}

export interface LocalPlayerDeps {
  scene: Phaser.Scene
  link: OfficeLink
  obstacles: Phaser.Physics.Arcade.StaticGroup
  seats: readonly SeatDef[]
  keys: MovementKeys
}

const anyDown = (keys: Phaser.Input.Keyboard.Key[]): boolean => keys.some((key) => key.isDown)

// The own avatar: predicted locally with Arcade physics (a 20x12 body at the feet), checked by the server.
export class LocalPlayer {
  readonly view: AvatarView
  private readonly deps: LocalPlayerDeps
  private readonly body: Phaser.Physics.Arcade.Body
  private readonly collider: Phaser.Physics.Arcade.Collider
  private readonly sender: MoveSender
  private readonly entry = new EntryBlock()
  private dir: Facing
  private seatId: string
  // A seat request is on its way; input waits for the answer.
  private busy = false
  // The connection is down (the SDK reconnects): no input, no moves.
  private paused = false
  private held: DirectionInput = NO_INPUT
  private hint: string | null = null
  // Set by the E key's down event and read once per frame. JustDown() would miss a tap whose key up arrives in
  // the same frame (Phaser clears the flag on key up).
  private interactPressed = false
  private destroyed = false
  // Set by placeAt until the next frame: Body.reset leaves body.center without the body offset until the next
  // physics step, so sample() reads the placed position meanwhile.
  private placed: Point | null = null
  // Dev builds only (e2e, walkTo): where the avatar walks instead of following the keys.
  private autopilot: Point | null = null
  private updatedAt: number | null = null
  private readonly onInteractKey = (): void => {
    this.interactPressed = true
  }

  constructor(deps: LocalPlayerDeps, state: PlayerState) {
    this.deps = deps
    this.dir = state.dir
    this.seatId = state.seatId
    const { scene } = deps
    this.view = new AvatarView(scene, state, state.dir, (key, frame) => scene.physics.add.sprite(state.x, state.y, key, frame))
    const sprite = this.view.sprite as Phaser.Physics.Arcade.Sprite
    this.body = sprite.body as Phaser.Physics.Arcade.Body
    // The body centre is the feet point: PLAYER_BODY.offsetY below the sprite centre.
    this.body
      .setSize(PLAYER_BODY.w, PLAYER_BODY.h, false)
      .setOffset((AVATAR_FRAME.width - PLAYER_BODY.w) / 2, AVATAR_FRAME.height / 2 + PLAYER_BODY.offsetY - PLAYER_BODY.h / 2)
      .setCollideWorldBounds(true)
    // Recompute the body position from the sprite with the new size and offset.
    this.body.reset(state.x, state.y)
    this.body.enable = this.seatId === ''
    this.view.setPose(this.dir, false, this.seated)
    this.collider = scene.physics.add.collider(sprite, deps.obstacles)
    this.sender = new MoveSender(this.sample(false))
    deps.keys.interact.on(Phaser.Input.Keyboard.Events.DOWN, this.onInteractKey)
  }

  get sprite(): Phaser.GameObjects.Sprite {
    return this.view.sprite
  }

  get seated(): boolean {
    return this.seatId !== ''
  }

  get walking(): boolean {
    return this.autopilot !== null
  }

  update(now: number): void {
    const { keys } = this.deps
    this.placed = null
    // At most one move interval per frame, so a stalled frame never turns into a jump.
    const dt = Math.min(now - (this.updatedAt ?? now), MOVE_INTERVAL_MS)
    this.updatedAt = now
    if (this.interactPressed) {
      this.interactPressed = false
      if (!this.paused) this.interact(now)
    }
    if (import.meta.env.DEV && this.autopilot && !this.busy && !this.seated && !this.paused) {
      this.steer(this.autopilot, now, dt)
      this.updateHint()
      return
    }
    this.held =
      this.busy || this.seated || this.paused
        ? NO_INPUT
        : { up: anyDown(keys.up), down: anyDown(keys.down), left: anyDown(keys.left), right: anyDown(keys.right) }
    const velocity = inputVelocity(this.entry.filter(this.held))
    const moving = velocity.vx !== 0 || velocity.vy !== 0
    if (this.body.enable) this.body.setVelocity(velocity.vx, velocity.vy)
    this.dir = facingFor(velocity, this.dir)
    this.view.setPose(this.dir, moving, this.seated)
    this.view.sync()
    if (!this.seated && !this.busy && !this.paused) this.send(now, moving, false)
    this.updateHint()
  }

  // Dev builds only (e2e): walk in a straight line to (x, y) at MAX_SPEED, whatever the frame rate, sending the
  // usual moves. It skips the local collision check, so the server decides: a move into a wall comes back as
  // move:reject, which snaps the avatar back and ends the walk.
  walkTo(x: number, y: number): void {
    if (!this.seated && !this.busy && !this.paused) this.autopilot = { x, y }
  }

  // The tab is hidden or the window lost focus: stop and tell the server at once.
  halt(now: number): void {
    this.autopilot = null
    if (this.body.enable) this.body.setVelocity(0, 0)
    if (!this.seated && !this.busy && !this.paused) this.send(now, false, true)
  }

  // The connection dropped: stand still and send nothing (the SDK would queue the moves and replay them later).
  pause(): void {
    this.paused = true
    this.autopilot = null
    if (this.body.enable) this.body.setVelocity(0, 0)
    this.view.setPose(this.dir, false, this.seated)
  }

  // Reconnected: go on from where the server has the player.
  resume(state: PlayerState): void {
    this.paused = false
    if (state.seatId !== '') this.sitAt(state.seatId, state.x, state.y, state.dir)
    else this.standUp(state.x, state.y)
  }

  // Server truth for the own player: look, and seats changed by the server (e.g. after a reconnect).
  applyServerState(state: PlayerState): void {
    this.view.setLook(state)
    if (this.busy || state.seatId === this.seatId) return
    if (state.seatId === '') this.standUp(state.x, state.y)
    else this.sitAt(state.seatId, state.x, state.y, state.dir)
  }

  reject(reject: MoveReject): void {
    if (this.seated || !this.sender.shouldApplyReject(reject.seq)) return
    this.autopilot = null
    this.placeAt(reject.x, reject.y)
    this.sender.reset(this.sample(false))
    if (isEntryReject(reject.reason)) {
      const toast = this.entry.block(this.held, reject.reason, performance.now())
      if (toast) EventBus.emit('toast', toast)
    }
  }

  destroy(): void {
    this.destroyed = true
    this.deps.keys.interact.off(Phaser.Input.Keyboard.Events.DOWN, this.onInteractKey)
    this.collider.destroy()
    this.view.destroy()
    if (this.hint !== null) EventBus.emit('seat-hint', null)
  }

  private steer(target: Point, now: number, dt: number): void {
    const { x, y } = this.sprite
    const dx = target.x - x
    const dy = target.y - y
    const remaining = Math.hypot(dx, dy)
    const step = (MAX_SPEED * dt) / 1000
    const arrived = remaining <= step
    this.body.setVelocity(0, 0)
    this.dir = facingFor({ vx: dx, vy: dy }, this.dir)
    this.placeAt(arrived ? target.x : x + (dx / remaining) * step, arrived ? target.y : y + (dy / remaining) * step)
    this.view.setPose(this.dir, !arrived)
    if (arrived) this.autopilot = null
    this.send(now, !arrived, arrived)
  }

  private send(now: number, moving: boolean, force: boolean): void {
    const move = this.sender.update(now, this.sample(moving), force)
    if (move) this.deps.link.sendMove(move)
  }

  // The sprite centre, from the body (already stepped this frame) when it is active.
  private sample(moving: boolean): MoveSample {
    const body = this.body.enable ? { x: this.body.center.x, y: this.body.center.y - PLAYER_BODY.offsetY } : this.sprite
    const { x, y } = this.placed ?? body
    return { x, y, dir: this.dir, moving }
  }

  private placeAt(x: number, y: number): void {
    this.body.reset(x, y)
    this.sprite.setPosition(x, y)
    this.view.sync()
    this.placed = { x, y }
  }

  private interact(now: number): void {
    if (this.busy) return
    const { link } = this.deps
    if (this.seated) {
      this.busy = true
      link.stand().then(
        (response) => this.standUp(response.x, response.y),
        () => EventBus.emit('toast', 'Could not stand up. Try again.'),
      ).finally(() => {
        this.busy = false
      })
      return
    }
    const seat = this.nearbySeat()
    if (!seat) return
    // Stop here first: the server measures the distance to the seat from the last move it accepted, and the
    // socket keeps the order, so this stop arrives before the request.
    this.autopilot = null
    this.body.setVelocity(0, 0)
    this.send(now, false, true)
    this.busy = true
    link.sit(seat.id).then(
      (response) => this.sitAt(response.seatId, response.x, response.y, response.dir),
      (error: unknown) => EventBus.emit('toast', sitRejectText(rejectReason(error))),
    ).finally(() => {
      this.busy = false
    })
  }

  // Also the answer of a seat request, which may arrive after destroy().
  private sitAt(seatId: string, x: number, y: number, dir: Facing): void {
    if (this.destroyed) return
    this.seatId = seatId
    this.dir = dir
    this.body.setVelocity(0, 0)
    this.placeAt(x, y)
    this.body.enable = false
    this.view.setPose(dir, false, true)
    this.sender.reset(this.sample(false))
  }

  // Where the server put the player when it stood up (beside the seat when the seat is not free floor).
  private standUp(x: number, y: number): void {
    if (this.destroyed) return
    this.seatId = ''
    this.body.enable = true
    this.placeAt(x, y)
    this.view.setPose(this.dir, false, false)
    this.sender.reset(this.sample(false))
  }

  private nearbySeat(): SeatDef | null {
    const { seats, link } = this.deps
    const feet = { x: this.body.center.x, y: this.body.center.y }
    return nearestFreeSeat(seats, feet, (seatId) => (link.state.seats.get(seatId)?.occupantId ?? '') === '', SEAT_HINT_RADIUS)
  }

  private updateHint(): void {
    const hint = this.busy ? this.hint : seatHint(this.seated, this.seated || this.paused ? null : this.nearbySeat())
    if (hint === this.hint) return
    this.hint = hint
    EventBus.emit('seat-hint', hint)
  }
}
