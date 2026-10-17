import Phaser from 'phaser'
import { EventBus } from '../EventBus.ts'
import { cameraBounds, fitZoom, type Size } from '../cameraFit.ts'

const MAP_KEY = 'office-map'
const MAP_DIR = 'assets/map'

// Texture keys equal the tileset names inside map.json.
const TILESETS = [
  'Room_Builder_Office',
  'Room_Builder_Floors',
  'Room_Builder_Walls',
  'Generic',
  'Modern_Office_Black_Shadow',
  'Classroom_and_library',
] as const

const TILE_LAYERS = ['Ground', 'Obj_layer1', 'Obj_layer2', 'Obj_layer3'] as const

export type TileLayerName = (typeof TILE_LAYERS)[number]

export class OfficeScene extends Phaser.Scene {
  readonly layers = new Map<TileLayerName, Phaser.Tilemaps.TilemapLayer>()
  private mapSize: Size = { width: 0, height: 0 }

  constructor() {
    super('office')
  }

  preload() {
    for (const name of TILESETS) this.load.image(name, `${MAP_DIR}/${name}.png`)
    this.load.tilemapTiledJSON(MAP_KEY, `${MAP_DIR}/map.json`)
  }

  create() {
    const map = this.make.tilemap({ key: MAP_KEY })
    const tilesets = TILESETS.map((name) => addTileset(map, name))

    this.layers.clear()
    for (const name of TILE_LAYERS) this.layers.set(name, createLayer(map, name, tilesets))

    this.mapSize = { width: map.widthInPixels, height: map.heightInPixels }
    this.physics.world.setBounds(0, 0, this.mapSize.width, this.mapSize.height)
    this.fitCamera(this.scale.gameSize)

    this.scale.on(Phaser.Scale.Events.RESIZE, this.fitCamera, this)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.fitCamera, this)
    })

    EventBus.emit('office-ready', this)
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
  if (!tileset) throw new Error(`Tileset "${name}" is missing from the map or its image did not load`)
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
