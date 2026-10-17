import type Phaser from 'phaser'
import type { ColliderDef } from '@vo/shared'

// One invisible Zone per collider rect, each with a static Arcade body. P1 adds the player collider
// against this group. Both kinds block movement; only walls block sound and sight.
export function createObstacles(
  scene: Phaser.Scene,
  colliders: readonly ColliderDef[],
): Phaser.Physics.Arcade.StaticGroup {
  const group = scene.physics.add.staticGroup()
  for (const { name, kind, rect } of colliders) {
    const zone = scene.add.zone(rect.x + rect.w / 2, rect.y + rect.h / 2, rect.w, rect.h)
    zone.setName(name).setData('kind', kind)
    group.add(zone)
  }
  return group
}
