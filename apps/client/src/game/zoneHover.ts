import Phaser from 'phaser'
import { zoneAt, type OfficeMap, type ZoneDef } from '@vo/shared'
import { EventBus, type ZoneHover } from './EventBus.ts'

export function toZoneHover(zone: ZoneDef | null): ZoneHover | null {
  return zone && { zoneId: zone.id, zoneType: zone.zoneType, mediaMode: zone.mediaMode }
}

// Emits 'zone-hover' when the zone under the mouse changes, and null when the mouse leaves the canvas.
export function watchZoneHover(scene: Phaser.Scene, map: OfficeMap): void {
  let currentId: string | null = null
  const update = (zone: ZoneDef | null): void => {
    const id = zone?.id ?? null
    if (id === currentId) return
    currentId = id
    EventBus.emit('zone-hover', toZoneHover(zone))
  }

  scene.input.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => {
    const world = scene.cameras.main.getWorldPoint(pointer.x, pointer.y)
    update(zoneAt(map, world.x, world.y))
  })
  scene.input.on(Phaser.Input.Events.GAME_OUT, () => update(null))
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => update(null))
}
