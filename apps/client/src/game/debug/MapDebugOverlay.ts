import type Phaser from 'phaser'
import type { ColliderKind, Facing, OfficeMap, Rect, SeatDef, SpawnDef, ZoneType } from '@vo/shared'
import { DEPTH } from '../depth.ts'

const ZONE_COLOR: Record<ZoneType, number> = {
  private: 0xab47bc,
  lobby: 0xffca28,
  meeting: 0x42a5f5,
  hallway: 0xbdbdbd,
  openplan: 0x66bb6a,
  desk: 0x26a69a,
}

const COLLIDER_COLOR: Record<ColliderKind, number> = { wall: 0xe53935, furniture: 0xfb8c00 }

const COLOR = {
  seat: 0xffffff,
  computerSeat: 0x00e5ff,
  whiteboard: 0xf06292,
  signage: 0xb388ff,
  stairs: 0xbcaaa4,
  spawn: 0x76ff03,
  outline: 0x000000,
}

const FACING_VECTOR: Record<Facing, readonly [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
}

const SEAT_RADIUS = 7

const css = (color: number): string => `#${color.toString(16).padStart(6, '0')}`

// Zones, seats, interactables, colliders and the spawn, drawn over the map at DEPTH.debug. Hidden at first.
export class MapDebugOverlay {
  private readonly layer: Phaser.GameObjects.Layer

  constructor(scene: Phaser.Scene, map: OfficeMap) {
    const g = scene.add.graphics()
    const labels: Phaser.GameObjects.Text[] = []
    const label = (x: number, y: number, text: string, color: number, originX = 0): void => {
      const style = {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: css(color),
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        padding: { x: 3, y: 1 },
        resolution: 2,
      }
      labels.push(scene.add.text(x, y, text, style).setOrigin(originX, 0))
    }

    for (const zone of map.zones) {
      const color = ZONE_COLOR[zone.zoneType]
      drawBox(g, zone.rect, color, 0.18, 2)
      label(zone.rect.x + 4, zone.rect.y + 4, `${zone.id} (${zone.zoneType}, ${zone.mediaMode})`, color)
    }
    for (const { kind, rect } of map.colliders) drawBox(g, rect, COLLIDER_COLOR[kind], 0.3, 1)
    for (const board of map.whiteboards) {
      drawBox(g, board.rect, COLOR.whiteboard, 0.35, 2)
      label(board.rect.x + 2, board.rect.y + board.rect.h - 16, board.id, COLOR.whiteboard)
    }
    for (const slot of map.signage) {
      drawBox(g, slot.rect, COLOR.signage, 0.35, 2)
      label(slot.rect.x + 2, slot.rect.y + slot.rect.h - 16, slot.id, COLOR.signage)
    }
    for (const stairs of map.stairs) {
      drawBox(g, stairs.rect, COLOR.stairs, 0.35, 2)
      label(stairs.rect.x + 4, stairs.rect.y + 4, 'stairs', COLOR.stairs)
    }
    for (const seat of map.seats) {
      const color = seat.hasComputer ? COLOR.computerSeat : COLOR.seat
      drawSeat(g, seat, color)
      label(seat.x, seat.y + SEAT_RADIUS + 1, seat.id, color, 0.5)
    }
    for (const spawn of map.spawns) {
      drawSpawn(g, spawn)
      label(spawn.x + 12, spawn.y - 8, `spawn ${spawn.id}`, COLOR.spawn)
    }

    this.layer = scene.add.layer([g, ...labels]).setDepth(DEPTH.debug).setVisible(false)
  }

  get visible(): boolean {
    return this.layer.visible
  }

  setVisible(visible: boolean): void {
    this.layer.setVisible(visible)
  }
}

function drawBox(g: Phaser.GameObjects.Graphics, r: Rect, color: number, fillAlpha: number, lineWidth: number): void {
  g.fillStyle(color, fillAlpha).fillRect(r.x, r.y, r.w, r.h)
  // Inset the outline so the borders of touching rects stay apart.
  const inset = lineWidth / 2
  g.lineStyle(lineWidth, color, 0.9).strokeRect(r.x + inset, r.y + inset, r.w - lineWidth, r.h - lineWidth)
}

function drawSeat(g: Phaser.GameObjects.Graphics, seat: SeatDef, color: number): void {
  const [dx, dy] = FACING_VECTOR[seat.facing]
  const reach = SEAT_RADIUS + 6
  g.lineStyle(3, color, 1).lineBetween(seat.x, seat.y, seat.x + dx * reach, seat.y + dy * reach)
  g.fillStyle(color, 1).fillCircle(seat.x, seat.y, SEAT_RADIUS)
  g.lineStyle(1.5, COLOR.outline, 1).strokeCircle(seat.x, seat.y, SEAT_RADIUS)
}

function drawSpawn(g: Phaser.GameObjects.Graphics, { x, y }: SpawnDef): void {
  g.lineStyle(3, COLOR.spawn, 1)
    .strokeCircle(x, y, 10)
    .lineBetween(x - 14, y, x + 14, y)
    .lineBetween(x, y - 14, x, y + 14)
}
