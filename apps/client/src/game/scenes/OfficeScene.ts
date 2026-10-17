import Phaser from 'phaser'
import { REQUIRED_TILE_LAYERS, type OfficeMap, type TilesetDef } from '@vo/shared'
import type { OfficeLink } from '../../net/officeLink.ts'
import { EventBus } from '../EventBus.ts'
import { cameraBounds, fitZoom, followZoom, type Size } from '../cameraFit.ts'
import { isMapDebugKey, mapDebugFromQuery } from '../debug/debugFlag.ts'
import { MapDebugOverlay } from '../debug/MapDebugOverlay.ts'
import { TILE_LAYER_DEPTH, type TileLayerName } from '../depth.ts'
import { createObstacles } from '../obstacles.ts'
import { onSceneEnd } from '../onSceneEnd.ts'
import type { MovementKeys } from '../player/LocalPlayer.ts'
import { readOfficeMap } from '../readOfficeMap.ts'
import { watchTyping } from '../typingFocus.ts'
import { OfficeSession } from '../session/OfficeSession.ts'
import { watchZoneHover } from '../zoneHover.ts'

const MAP_KEY = 'office-map'
// From the site root, so the map also loads on a nested URL such as /invite/abc.
const MAP_DIR = `${import.meta.env.BASE_URL}assets/map`

// Tileset image paths in map.json are relative to the map file.
const tilesetUrl = (tileset: TilesetDef): string => `${MAP_DIR}/${tileset.image}`

export class OfficeScene extends Phaser.Scene {
  readonly layers = new Map<TileLayerName, Phaser.Tilemaps.TilemapLayer>()
  officeMap!: OfficeMap
  // Static bodies for every Collision rect (walls and furniture); the own avatar collides with them.
  obstacles!: Phaser.Physics.Arcade.StaticGroup
  private debugOverlay!: MapDebugOverlay
  private mapSize: Size = { width: 0, height: 0 }
  private keys!: MovementKeys
  private session: OfficeSession | null = null
  private followed: Phaser.GameObjects.Sprite | null = null

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
    onSceneEnd(this, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.fitCamera, this)
      this.session?.destroy(true)
      this.session = null
      this.followed = null
    })
    this.keys = createMovementKeys(this)
    // Keys typed into a form field (the invite role, a link to copy) do not walk the avatar.
    const keyboard = this.input.keyboard
    const stopWatching = watchTyping((typing) => {
      if (!keyboard) return
      keyboard.enabled = !typing
      if (typing) keyboard.resetKeys()
    })
    onSceneEnd(this, stopWatching)

    this.debugOverlay = new MapDebugOverlay(this, this.officeMap)
    this.setMapDebug(mapDebugFromQuery(window.location.search))
    this.input.keyboard?.on(Phaser.Input.Keyboard.Events.ANY_KEY_DOWN, (event: KeyboardEvent) => {
      if (isMapDebugKey(event) && !event.repeat) this.setMapDebug(!this.debugOverlay.visible)
    })
    watchZoneHover(this, this.officeMap)

    EventBus.emit('office-ready', this)
  }

  override update(time: number) {
    this.session?.update(time)
  }

  // Shows the connected office: the own avatar (camera follows it), the others, seats and presence.
  attach(link: OfficeLink) {
    this.detach()
    this.session = new OfficeSession({
      scene: this,
      link,
      map: this.officeMap,
      obstacles: this.obstacles,
      keys: this.keys,
      follow: (sprite) => this.follow(sprite),
    })
  }

  setReconnecting(reconnecting: boolean) {
    this.session?.setReconnecting(reconnecting)
  }

  // Back to the empty map (left the room, connection lost).
  detach() {
    const session = this.session
    this.session = null
    session?.destroy()
  }

  setMapDebug(visible: boolean) {
    this.debugOverlay.setVisible(visible)
    EventBus.emit('map-debug', visible)
  }

  private follow(sprite: Phaser.GameObjects.Sprite | null) {
    this.followed = sprite
    if (!sprite) this.cameras.main.stopFollow()
    this.fitCamera(this.scale.gameSize)
  }

  // Following the own avatar: integer zoom (2, or 1 on small screens). Without one: the whole map, centred.
  private fitCamera(view: Size) {
    const camera = this.cameras.main
    const zoom = this.followed ? followZoom(view) : fitZoom(view, this.mapSize)
    const bounds = cameraBounds(view, this.mapSize, zoom)
    camera.setZoom(zoom).setBounds(bounds.x, bounds.y, bounds.width, bounds.height)
    if (this.followed) camera.startFollow(this.followed, true)
    else camera.centerOn(this.mapSize.width / 2, this.mapSize.height / 2)
  }
}

// Arrow keys and WASD, E to sit or stand. No capture: the keys still reach the page (buttons, later the chat).
// While a form field has focus the scene ignores the keyboard (watchTyping).
function createMovementKeys(scene: Phaser.Scene): MovementKeys {
  const keyboard = scene.input.keyboard
  if (!keyboard) throw new Error('The office scene needs keyboard input')
  const key = (code: number) => keyboard.addKey(code, false)
  const K = Phaser.Input.Keyboard.KeyCodes
  return {
    up: [key(K.UP), key(K.W)],
    down: [key(K.DOWN), key(K.S)],
    left: [key(K.LEFT), key(K.A)],
    right: [key(K.RIGHT), key(K.D)],
    interact: key(K.E),
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
