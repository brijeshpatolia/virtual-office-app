import Phaser from 'phaser'
import type { MediaMode, ZoneType } from '@vo/shared'
import type { OfficeScene } from './scenes/OfficeScene.ts'

export interface ZoneHover {
  zoneId: string
  zoneType: ZoneType
  mediaMode: MediaMode
}

// Every event between Phaser and React, with its arguments.
export type GameEvents = {
  'office-ready': [scene: OfficeScene]
  'zone-hover': [zone: ZoneHover | null]
  'map-debug': [visible: boolean]
  // The E-key hint near a seat ('E: sit', 'E: sit (computer)', 'E: stand'), null when none applies.
  'seat-hint': [hint: string | null]
  // A short message over the map: zone entered, seat taken.
  toast: [text: string]
}

export type GameEventName = keyof GameEvents
type Handler<E extends GameEventName> = (...args: GameEvents[E]) => void

class TypedEventBus {
  private readonly emitter = new Phaser.Events.EventEmitter()

  on<E extends GameEventName>(event: E, handler: Handler<E>, context?: unknown): this {
    this.emitter.on(event, handler, context)
    return this
  }

  once<E extends GameEventName>(event: E, handler: Handler<E>, context?: unknown): this {
    this.emitter.once(event, handler, context)
    return this
  }

  off<E extends GameEventName>(event: E, handler?: Handler<E>, context?: unknown): this {
    this.emitter.off(event, handler, context)
    return this
  }

  emit<E extends GameEventName>(event: E, ...args: GameEvents[E]): boolean {
    return this.emitter.emit(event, ...args)
  }
}

// Single channel between React and Phaser.
export const EventBus = new TypedEventBus()
