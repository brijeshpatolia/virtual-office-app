import Phaser from 'phaser'
import { zoneAt, type OfficeMap, type ZoneDef } from '@vo/shared'
import { EventBus, type ZoneHover } from './EventBus.ts'
import { onSceneEnd } from './onSceneEnd.ts'

export function toZoneHover(zone: ZoneDef | null): ZoneHover | null {
  return zone && { zoneId: zone.id, zoneType: zone.zoneType, mediaMode: zone.mediaMode }
}

// Emits 'zone-hover' when the zone under the mouse changes, and null when the mouse leaves the canvas.
export function watchZoneHover(scene: Phaser.Scene, map: OfficeMap): void {
  let currentId: string | null = null
  // The mouse position on the canvas; null when it is outside.
  let screen: { x: number; y: number } | null = null
  const update = (zone: ZoneDef | null): void => {
    const id = zone?.id ?? null
    if (id === currentId) return
    currentId = id
    EventBus.emit('zone-hover', toZoneHover(zone))
  }
  const check = (): void => {
    if (screen === null) return
    const world = scene.cameras.main.getWorldPoint(screen.x, screen.y)
    update(zoneAt(map, world.x, world.y))
  }

  scene.input.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => {
    screen = { x: pointer.x, y: pointer.y }
    check()
  })
  scene.input.on(Phaser.Input.Events.GAME_OUT, () => {
    screen = null
    update(null)
  })
  // The camera follows the own avatar, so the zone under a mouse at rest changes too.
  scene.events.on(Phaser.Scenes.Events.POST_UPDATE, check)
  onSceneEnd(scene, () => {
    scene.events.off(Phaser.Scenes.Events.POST_UPDATE, check)
    update(null)
  })
}
