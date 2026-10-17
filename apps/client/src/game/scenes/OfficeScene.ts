import Phaser from 'phaser'
import { REQUIRED_TILE_LAYERS, type OfficeMap, type TilesetDef } from '@vo/shared'
import { EventBus } from '../EventBus.ts'
import { cameraBounds, fitZoom, type Size } from '../cameraFit.ts'
import { isMapDebugKey, mapDebugFromQuery } from '../debug/debugFlag.ts'
import { MapDebugOverlay } from '../debug/MapDebugOverlay.ts'
import { TILE_LAYER_DEPTH, type TileLayerName } from '../depth.ts'
import { createObstacles } from '../obstacles.ts'
import { onSceneEnd } from '../onSceneEnd.ts'
import { readOfficeMap } from '../readOfficeMap.ts'
import { watchZoneHover } from '../zoneHover.ts'

const MAP_KEY = 'office-map'
// From the site root, so the map also loads on a nested URL such as /invite/abc.
const MAP_DIR = `${import.meta.env.BASE_URL}assets/map`

// Tileset image paths in map.json are relative to the map file.
const tilesetUrl = (tileset: TilesetDef): string => `${MAP_DIR}/${tileset.image}`

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
    this.load.tilemapTiledJSON(MAP_KEY, `${MAP_DIR}/map.json`)
    // A restart finds the map and its images in the caches already.
    if (this.cache.tilemap.exists(MAP_KEY)) return
    // map.json names the tileset images, so they join the same load once it is in the cache.
    this.load.once(`${Phaser.Loader.Events.FILE_KEY_COMPLETE}tilemapJSON-${MAP_KEY}`, () => {
      this.officeMap = readOfficeMap(this, MAP_KEY)
      // The texture key is the tileset name.
      for (const tileset of this.officeMap.tilesets) this.load.image(tileset.name, tilesetUrl(tileset))
    })
  }

  create() {
    if (!this.cache.tilemap.exists(MAP_KEY)) throw new Error(`Office map ${MAP_DIR}/map.json did not load`)
    const tilemap = this.make.tilemap({ key: MAP_KEY })
    const tilesets = this.officeMap.tilesets.map((tileset) => addTileset(tilemap, tileset))

    this.layers.clear()
    for (const name of REQUIRED_TILE_LAYERS) {
      this.layers.set(name, createLayer(tilemap, name, tilesets).setDepth(TILE_LAYER_DEPTH[name]))
    }

    this.obstacles = createObstacles(this, this.officeMap.colliders)
    this.mapSize = { width: this.officeMap.widthPx, height: this.officeMap.heightPx }
    this.physics.world.setBounds(0, 0, this.mapSize.width, this.mapSize.height)
    this.fitCamera(this.scale.gameSize)

    this.scale.on(Phaser.Scale.Events.RESIZE, this.fitCamera, this)
    onSceneEnd(this, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.fitCamera, this))

    this.debugOverlay = new MapDebugOverlay(this, this.officeMap)
    this.setMapDebug(mapDebugFromQuery(window.location.search))
    this.input.keyboard?.on(Phaser.Input.Keyboard.Events.ANY_KEY_DOWN, (event: KeyboardEvent) => {
      if (isMapDebugKey(event) && !event.repeat) this.setMapDebug(!this.debugOverlay.visible)
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

function addTileset(map: Phaser.Tilemaps.Tilemap, def: TilesetDef): Phaser.Tilemaps.Tileset {
  const tileset = map.addTilesetImage(def.name, def.name)
  if (!tileset) throw new Error(`Tileset "${def.name}": its image ${tilesetUrl(def)} did not load; check "image" in map.json`)
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
