import Phaser from 'phaser'
import type { MoveReject, OfficeMap, PlayerState } from '@vo/shared'
import type { OfficeLink, Unsubscribe } from '../../net/officeLink.ts'
import { EventBus } from '../EventBus.ts'
import { LocalPlayer, type MovementKeys } from '../player/LocalPlayer.ts'
import { RemoteAvatar } from '../remote/RemoteAvatar.ts'
import { zoneToastText } from '../zoneToast.ts'
import { ActivityReporter } from './activity.ts'
import { debugExtras, type ChatDebug } from './debugExtras.ts'

export interface OfficeSessionDeps {
  scene: Phaser.Scene
  link: OfficeLink
  map: OfficeMap
  obstacles: Phaser.Physics.Arcade.StaticGroup
  keys: MovementKeys
  follow(sprite: Phaser.GameObjects.Sprite | null): void
}

// What tests and the e2e step read from the page (window.__voOffice).
export interface OfficeDebugSnapshot {
  sessionId: string
  // move:reject messages received from the server, and the last one.
  rejects: number
  lastReject: MoveReject | null
  // walking: a walkTo is under way. pose: what the own avatar shows ('idle', 'walk' or 'sit').
  local: { x: number; y: number; dir: string; seatId: string; zoneId: string; status: string; walking: boolean; pose: string } | null
  // The synced state of every player; rendered: where and how the other avatars are drawn now (null for the own one).
  players: Array<{
    sessionId: string
    userId: string
    name: string
    x: number
    y: number
    seatId: string
    zoneId: string
    rendered: { x: number; y: number; dir: string; pose: string } | null
  }>
  // seatId -> occupant userId ('' = free).
  seats: Record<string, string>
  // The chat bar, when it is on the page.
  chat?: ChatDebug
}

export interface OfficeDebugHandle {
  snapshot(): OfficeDebugSnapshot
  // Dev builds only: LocalPlayer.walkTo (the e2e test walks with it where it needs to hit a doorway).
  walkTo?(x: number, y: number): void
}

// The connected office inside the scene: the own avatar, the others, seats, zone toasts and presence reports.
// Created by OfficeScene.attach(link), destroyed by detach() or when the scene ends.
export class OfficeSession {
  private readonly deps: OfficeSessionDeps
  private readonly remotes = new Map<string, { avatar: RemoteAvatar; unsubscribe: Unsubscribe }>()
  private readonly subscriptions: Unsubscribe[] = []
  private readonly activity: ActivityReporter
  private local: LocalPlayer | null = null
  private localZoneId = ''
  private rejects = 0
  private lastReject: MoveReject | null = null
  private reconnecting = false

  constructor(deps: OfficeSessionDeps) {
    this.deps = deps
    const { link, scene } = deps
    this.activity = new ActivityReporter((activity) => link.sendActivity(activity), () => performance.now())
    this.subscriptions.push(
      link.onPlayerAdd((player, sessionId) => this.add(player, sessionId)),
      link.onPlayerRemove((_player, sessionId) => this.remove(sessionId)),
      link.onMoveReject((reject) => {
        this.rejects += 1
        this.lastReject = reject
        this.local?.reject(reject)
      }),
    )
    document.addEventListener('visibilitychange', this.onVisibility)
    // Opened in a background tab: the server counts down to away from now.
    if (document.hidden) this.activity.visibility(true)
    scene.input.keyboard?.on(Phaser.Input.Keyboard.Events.ANY_KEY_DOWN, this.onInput)
    scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.onInput)
    scene.game.events.on(Phaser.Core.Events.BLUR, this.onBlur)
    const debug: OfficeDebugHandle = { snapshot: () => this.snapshot() }
    // Production builds drop this branch.
    if (import.meta.env.DEV) debug.walkTo = (x, y) => this.local?.walkTo(x, y)
    Object.assign(window, { __voOffice: debug })
  }

  update(now: number): void {
    this.local?.update(now)
    for (const { avatar } of this.remotes.values()) avatar.update(now)
  }

  // While the SDK reconnects the own avatar stands still and sends nothing; afterwards it goes on from the
  // server's position.
  setReconnecting(reconnecting: boolean): void {
    if (reconnecting === this.reconnecting) return
    this.reconnecting = reconnecting
    if (reconnecting) {
      this.local?.pause()
      return
    }
    const own = this.deps.link.state.players.get(this.deps.link.sessionId)
    if (own) this.local?.resume(own)
  }

  snapshot(): OfficeDebugSnapshot {
    const { link } = this.deps
    const own = link.state.players.get(link.sessionId)
    const sprite = this.local?.sprite
    return {
      sessionId: link.sessionId,
      rejects: this.rejects,
      lastReject: this.lastReject,
      local:
        own && sprite
          ? {
              x: sprite.x,
              y: sprite.y,
              dir: own.dir,
              seatId: own.seatId,
              zoneId: own.zoneId,
              status: own.status,
              walking: this.local?.walking ?? false,
              pose: this.local?.view.pose ?? 'idle',
            }
          : null,
      players: [...link.state.players].map(([sessionId, p]) => ({
        sessionId,
        userId: p.userId,
        name: p.name,
        x: p.x,
        y: p.y,
        seatId: p.seatId,
        zoneId: p.zoneId,
        rendered: this.remotes.get(sessionId)?.avatar.rendered ?? null,
      })),
      seats: Object.fromEntries([...link.state.seats].map(([seatId, seat]) => [seatId, seat.occupantId])),
      ...(debugExtras.chat ? { chat: debugExtras.chat() } : {}),
    }
  }

  // sceneEnding: the scene is shutting down and destroys its own game objects (its cameras and physics are
  // already gone), so only the room and DOM subscriptions are dropped.
  destroy(sceneEnding = false): void {
    for (const unsubscribe of this.subscriptions.splice(0)) unsubscribe()
    for (const { unsubscribe } of this.remotes.values()) unsubscribe()
    document.removeEventListener('visibilitychange', this.onVisibility)
    Object.assign(window, { __voOffice: undefined })
    const { scene } = this.deps
    scene.game.events.off(Phaser.Core.Events.BLUR, this.onBlur)
    if (sceneEnding) return
    scene.input.keyboard?.off(Phaser.Input.Keyboard.Events.ANY_KEY_DOWN, this.onInput)
    scene.input.off(Phaser.Input.Events.POINTER_MOVE, this.onInput)
    this.deps.follow(null)
    this.local?.destroy()
    this.local = null
    for (const { avatar } of this.remotes.values()) avatar.destroy()
    this.remotes.clear()
  }

  private add(player: PlayerState, sessionId: string): void {
    const { link, scene } = this.deps
    if (sessionId === link.sessionId) {
      if (this.local) return
      const { obstacles, keys, map } = this.deps
      const local = new LocalPlayer({ scene, link, obstacles, keys, seats: map.seats }, player)
      this.local = local
      this.localZoneId = player.zoneId
      this.deps.follow(local.sprite)
      this.subscriptions.push(link.onPlayerChange(player, () => this.onLocalChange(local, player)))
      return
    }
    if (this.remotes.has(sessionId)) return
    const avatar = new RemoteAvatar(scene, player, performance.now())
    const unsubscribe = link.onPlayerChange(player, () => avatar.onServerChange(performance.now()))
    this.remotes.set(sessionId, { avatar, unsubscribe })
  }

  private remove(sessionId: string): void {
    const remote = this.remotes.get(sessionId)
    if (!remote) return
    remote.unsubscribe()
    remote.avatar.destroy()
    this.remotes.delete(sessionId)
  }

  private onLocalChange(local: LocalPlayer, player: PlayerState): void {
    if (this.local !== local) return
    local.applyServerState(player)
    const toast = zoneToastText(this.deps.map, this.localZoneId, player.zoneId)
    this.localZoneId = player.zoneId
    if (toast) EventBus.emit('toast', toast)
  }

  private readonly onVisibility = (): void => {
    if (document.hidden) this.local?.halt(performance.now())
    this.activity.visibility(document.hidden)
  }

  private readonly onBlur = (): void => {
    this.local?.halt(performance.now())
  }

  private readonly onInput = (): void => {
    this.activity.input()
  }
}
