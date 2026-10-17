import Phaser from 'phaser'
import { REQUIRED_TILE_LAYERS, type OfficeMap } from '@vo/shared'
import { EventBus } from '../EventBus.ts'
import { cameraBounds, fitZoom, type Size } from '../cameraFit.ts'
import { MAP_DEBUG_KEY_CODE, mapDebugFromQuery } from '../debug/debugFlag.ts'
import { MapDebugOverlay } from '../debug/MapDebugOverlay.ts'
import { TILE_LAYER_DEPTH, type TileLayerName } from '../depth.ts'
import { createObstacles } from '../obstacles.ts'
import { readOfficeMap } from '../readOfficeMap.ts'
import { watchZoneHover } from '../zoneHover.ts'

const MAP_KEY = 'office-map'
const MAP_DIR = 'assets/map'

// Texture keys equal the tileset names inside map.json.
const TILESET_IMAGES = [
  'Room_Builder_Office',
  'Room_Builder_Floors',
  'Room_Builder_Walls',
  'Generic',
  'Modern_Office_Black_Shadow',
  'Classroom_and_library',
] as const

export class OfficeScene extends Phaser.Scene {
  readonly layers = new Map<TileLayerName, Phaser.Tilemaps.TilemapLayer>()
  officeMap!: OfficeMap
  // Static bodies for every Collision rect (walls and furniture). P1 adds the player collider against it.
  obstacles!: Phaser.Physics.Arcade.StaticGroup
  private debugOverlay!: MapDebugOverlay
  private mapSize: Size = { width: 0, height: 0 }

  constructor() {
    super('office')
  }

  preload() {
    for (const name of TILESET_IMAGES) this.load.image(name, `${MAP_DIR}/${name}.png`)
    this.load.tilemapTiledJSON(MAP_KEY, `${MAP_DIR}/map.json`)
  }

  create() {
    this.officeMap = readOfficeMap(this, MAP_KEY)
    const tilemap = this.make.tilemap({ key: MAP_KEY })
    const tilesets = this.officeMap.tilesetNames.map((name) => addTileset(tilemap, name))

    this.layers.clear()
    for (const name of REQUIRED_TILE_LAYERS) {
      this.layers.set(name, createLayer(tilemap, name, tilesets).setDepth(TILE_LAYER_DEPTH[name]))
    }

    this.obstacles = createObstacles(this, this.officeMap.colliders)
    this.mapSize = { width: this.officeMap.widthPx, height: this.officeMap.heightPx }
    this.physics.world.setBounds(0, 0, this.mapSize.width, this.mapSize.height)
    this.fitCamera(this.scale.gameSize)

    this.scale.on(Phaser.Scale.Events.RESIZE, this.fitCamera, this)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.fitCamera, this)
    })

    this.debugOverlay = new MapDebugOverlay(this, this.officeMap)
    this.setMapDebug(mapDebugFromQuery(window.location.search))
    this.input.keyboard?.on(Phaser.Input.Keyboard.Events.ANY_KEY_DOWN, (event: KeyboardEvent) => {
      if (event.code === MAP_DEBUG_KEY_CODE && !event.repeat) this.setMapDebug(!this.debugOverlay.visible)
    })
    watchZoneHover(this, this.officeMap)

    EventBus.emit('office-ready', this)
  }

  setMapDebug(visible: boolean) {
    this.debugOverlay.setVisible(visible)
    EventBus.emit('map-debug', visible)
  }

  private fitCamera(view: Size) {
    const zoom = fitZoom(view, this.mapSize)
    const bounds = cameraBounds(view, this.mapSize, zoom)
    this.cameras.main
      .setZoom(zoom)
      .setBounds(bounds.x, bounds.y, bounds.width, bounds.height)
      .centerOn(this.mapSize.width / 2, this.mapSize.height / 2)
  }
}

function addTileset(map: Phaser.Tilemaps.Tilemap, name: string): Phaser.Tilemaps.Tileset {
  const tileset = map.addTilesetImage(name, name)
  if (!tileset) throw new Error(`Tileset "${name}" has no image; add it to TILESET_IMAGES in OfficeScene.ts`)
  return tileset
}

function createLayer(
  map: Phaser.Tilemaps.Tilemap,
  name: TileLayerName,
  tilesets: Phaser.Tilemaps.Tileset[],
): Phaser.Tilemaps.TilemapLayer {
  const layer = map.createLayer(name, tilesets)
  // The typings omit it, but createLayer returns null for an unknown layer name.
  if (!(layer instanceof Phaser.Tilemaps.TilemapLayer)) throw new Error(`Tile layer "${name}" is missing from the map`)
  return layer
}
