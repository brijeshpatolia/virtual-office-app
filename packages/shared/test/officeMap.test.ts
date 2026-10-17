import { describe, expect, it } from 'vitest'
import { OfficeMapError, parseOfficeMap } from '../src/officeMap.ts'
import {
  baseTiledMap,
  center,
  COMPUTER_GID,
  layerOf,
  mapWith,
  objectLayerOf,
  objectOf,
  parsedWith,
  parseIssues,
  removeLayer,
  removeProp,
  setProp,
  tileLayerOf,
} from './helpers/tiledMap.ts'

describe('parseOfficeMap', () => {
  it('reads the map, its layers and every object class', () => {
    const map = parseOfficeMap(baseTiledMap())

    expect(map).toMatchObject({
      width: 10,
      height: 8,
      tileWidth: 32,
      tileHeight: 32,
      widthPx: 320,
      heightPx: 256,
      templateId: 'test-10x8',
      templateVersion: 1,
      tilesetNames: ['Test'],
    })
    expect(map.tileLayers.map((l) => l.name)).toEqual(['Ground', 'Obj_layer1', 'Obj_layer2', 'Obj_layer3', 'Computers', 'Above'])
    expect(map.tileLayers[4]?.data[2 * 10 + 3]).toBe(COMPUTER_GID)
    expect(map.zones[0]).toEqual({
      id: 'room',
      zoneType: 'meeting',
      mediaMode: 'room',
      capacity: 4,
      lockable: true,
      priority: 2,
      rect: { x: 32, y: 32, w: 128, h: 192 },
    })
    expect(map.seats[0]).toEqual({ id: 's1', zoneId: 'room', ...center(2, 2), facing: 'down', hasComputer: true })
    expect(map.whiteboards).toEqual([{ id: 'wb1', zoneId: 'room', rect: { x: 32, y: 32, w: 64, h: 32 } }])
    expect(map.signage).toEqual([{ id: 'sign1', rect: { x: 192, y: 32, w: 32, h: 32 } }])
    expect(map.stairs).toEqual([{ targetFloor: '', rect: { x: 192, y: 192, w: 32, h: 32 } }])
    expect(map.colliders).toHaveLength(7)
    expect(map.colliders.at(-1)).toEqual({ name: 'table', kind: 'furniture', rect: { x: 64, y: 96, w: 64, h: 32 } })
    expect(map.spawns).toEqual([{ id: 'main', ...center(7, 2) }])
  })

  it('reads properties by name, in any order', () => {
    const reversed = mapWith((m) => {
      m.properties?.reverse()
      for (const layer of m.layers) {
        if (layer.type === 'objectgroup' && 'objects' in layer) {
          for (const o of layer.objects) o.properties?.reverse()
        }
      }
    })
    expect(parseOfficeMap(reversed)).toEqual(parseOfficeMap(baseTiledMap()))
  })

  it('ignores unknown properties and unknown fields', () => {
    const map = parsedWith((m) => {
      const seat = objectOf(m, 'Seats', 's1')
      setProp(seat, 'note', 'by the window')
      Object.assign(seat, { someFutureField: 1 })
      Object.assign(m, { editorsettings: { export: { format: 'json' } } })
    })
    expect(map.seats[0]).toEqual({ id: 's1', zoneId: 'room', ...center(2, 2), facing: 'down', hasComputer: true })
  })

  it('treats a property without a type as a string, like older Tiled versions', () => {
    const map = parsedWith((m) => {
      const prop = objectOf(m, 'Seats', 's1').properties?.find((p) => p.name === 'facing')
      if (prop) delete prop.type
    })
    expect(map.seats[0]?.facing).toBe('down')
  })

  it('takes object ids from properties, not from the object order', () => {
    const map = parsedWith((m) => objectLayerOf(m, 'Seats').objects.reverse())
    expect(map.seats.map((s) => s.id)).toEqual(['s2', 's1'])
  })

  it('throws OfficeMapError with all issues at once', () => {
    const json = mapWith((m) => {
      removeLayer(m, 'Above')
      setProp(objectOf(m, 'Zones', 'room'), 'capacity', '4', 'string')
    })
    expect(() => parseOfficeMap(json)).toThrow(OfficeMapError)
    const issues = parseIssues(json)
    expect(issues).toHaveLength(2)
    expect(issues[0]).toBe('missing tile layer "Above"')
    expect(issues[1]).toMatch(/object id \d+ "room": property "capacity" must be int, got string "4"/)
  })

  describe('structure errors', () => {
    const cases: [string, (m: ReturnType<typeof baseTiledMap>) => void, RegExp][] = [
      ['a missing tile layer', (m) => removeLayer(m, 'Computers'), /missing tile layer "Computers"/],
      ['a missing object layer', (m) => removeLayer(m, 'Spawn'), /missing object layer "Spawn"/],
      [
        'a layer of the wrong type',
        (m) => {
          const zones = objectLayerOf(m, 'Zones')
          Object.assign(zones, { type: 'tilelayer', width: 10, height: 8, data: new Array<number>(80).fill(0) })
        },
        /layer "Zones" must be an object layer \(objectgroup\), got tilelayer/,
      ],
      ['a duplicate layer name', (m) => m.layers.push({ ...tileLayerOf(m, 'Above'), id: 99 }), /layer "Above" appears more than once/],
      ['a group layer', (m) => m.layers.push({ id: 99, name: 'Group', type: 'group', layers: [] }), /group layers are not supported/],
      [
        'an int property stored as a string',
        (m) => setProp(objectOf(m, 'Zones', 'open'), 'priority', '0', 'string'),
        /"open": property "priority" must be int, got string "0"/,
      ],
      [
        'a bool property stored as an int',
        (m) => setProp(objectOf(m, 'Seats', 's1'), 'hasComputer', 1, 'int'),
        /"s1": property "hasComputer" must be bool, got int 1/,
      ],
      [
        'an int property with a fractional value',
        (m) => setProp(objectOf(m, 'Zones', 'room'), 'capacity', 4.5, 'int'),
        /property "capacity" must be int, got int 4.5/,
      ],
      ['a missing property', (m) => removeProp(objectOf(m, 'Seats', 's2'), 'facing'), /"s2": missing property "facing" \(string\)/],
      ['an empty id', (m) => setProp(objectOf(m, 'Seats', 's2'), 'seatId', ' '), /property "seatId" must not be empty/],
      [
        'mediaMode "group"',
        (m) => setProp(objectOf(m, 'Zones', 'room'), 'mediaMode', 'group'),
        /property "mediaMode" must be one of proximity, room; got "group"/,
      ],
      ['an unknown facing', (m) => setProp(objectOf(m, 'Seats', 's1'), 'facing', 'north'), /"facing" must be one of up, down, left, right/],
      ['an unknown collider kind', (m) => setProp(objectOf(m, 'Collision', 'table'), 'kind', 'glass'), /"kind" must be one of wall, furniture/],
      ['a negative capacity', (m) => setProp(objectOf(m, 'Zones', 'room'), 'capacity', -1), /capacity must be 0 \(no limit\) or more/],
      [
        'an external tileset',
        (m) => m.tilesets.push({ firstgid: 600, source: 'office.tsx' }),
        /tileset #1 \(firstgid 600\): external tileset "office.tsx"; embed it in the map/,
      ],
      ['a rotated object', (m) => (objectOf(m, 'Zones', 'desk').rotation = 90), /"desk": rotated objects are not allowed/],
      ['a tile object (gid)', (m) => (objectOf(m, 'Interactables', 'sign1').gid = 42), /"sign1": tile objects \(gid\) cannot carry map data/],
      ['an object template', (m) => (objectOf(m, 'Seats', 's2').template = 'seat.tx'), /"s2": object templates are not supported/],
      ['an ellipse zone', (m) => (objectOf(m, 'Zones', 'desk').ellipse = true), /"desk": must be a rectangle, got a ellipse/],
      ['a point zone', (m) => Object.assign(objectOf(m, 'Zones', 'desk'), { point: true, width: 0, height: 0 }), /must be a rectangle, got a point/],
      [
        'a rectangle seat',
        (m) => Object.assign(objectOf(m, 'Seats', 's1'), { point: undefined, width: 32, height: 32 }),
        /"s1": must be a point, got a rectangle/,
      ],
      ['a zero-size rectangle', (m) => (objectOf(m, 'Collision', 'table').width = 0), /rectangle needs a positive width and height/],
      [
        'a class that does not belong in the layer',
        (m) => (objectOf(m, 'Zones', 'desk').type = 'seat'),
        /"desk": class "seat" is not allowed here \(allowed: zone\)/,
      ],
      ['an object without a class', (m) => (objectOf(m, 'Spawn', 'main').type = ''), /class "" is not allowed here \(allowed: spawn\)/],
      ['an offset object layer', (m) => (objectLayerOf(m, 'Seats').offsetx = 8), /layer "Seats": layer offsets are not supported/],
      ['an isometric map', (m) => (m.orientation = 'isometric'), /orientation must be orthogonal, got isometric/],
      ['an infinite map', (m) => (m.infinite = true), /infinite maps are not supported/],
      [
        'base64 tile data',
        (m) => Object.assign(tileLayerOf(m, 'Ground'), { encoding: 'base64', data: 'AAAA' }),
        /layer "Ground" > data: tile data must be a JSON array/,
      ],
      ['a tile layer of the wrong size', (m) => (tileLayerOf(m, 'Above').width = 9), /layer "Above": size 9x8 must match the map size 10x8/],
      ['a short tile layer', (m) => tileLayerOf(m, 'Above').data = [0, 0], /layer "Above": has 2 tiles, expected 80/],
      ['a duplicate property', (m) => objectOf(m, 'Seats', 's1').properties?.push({ name: 'facing', type: 'string', value: 'up' }), /property "facing" is defined more than once/],
      ['a map property of the wrong type', (m) => (m.properties = [{ name: 'templateVersion', type: 'string', value: '1' }]), /map: property "templateVersion" must be int/],
      ['an object with a non-numeric x', (m) => Object.assign(objectOf(m, 'Seats', 's1'), { x: '80' }), /layer "Seats" > object id \d+ > x: /],
      ['an unknown layer type', (m) => m.layers.push({ id: 99, name: 'Odd', type: 'hexlayer' }), /layer "Odd" > type: layer type must be/],
    ]

    it.each(cases)('rejects %s', (_label, mutate, expected) => {
      const issues = parseIssues(mapWith(mutate))
      expect(issues.some((i) => expected.test(i)), issues.join('\n')).toBe(true)
    })

    it('rejects input that is not a map object', () => {
      for (const json of [null, [], 'map', { layers: 'none' }]) {
        expect(() => parseOfficeMap(json)).toThrow(OfficeMapError)
      }
      expect(parseIssues({})[0]).toMatch(/^orientation: /)
    })

    it('reads a map without map properties, leaving the template check to the validator', () => {
      const map = parsedWith((m) => delete m.properties)
      expect(map.templateId).toBe('')
      expect(map.templateVersion).toBe(0)
    })

    it('keeps extra tile layers in file order and ignores extra object layers', () => {
      const map = parsedWith((m) => {
        m.layers.splice(1, 0, { ...tileLayerOf(m, 'Above'), id: 50, name: 'Decals' })
        m.layers.push({ ...objectLayerOf(m, 'Seats'), id: 51, name: 'Notes' })
      })
      expect(map.tileLayers.map((l) => l.name)).toEqual(['Ground', 'Decals', 'Obj_layer1', 'Obj_layer2', 'Obj_layer3', 'Computers', 'Above'])
      expect(map.seats).toHaveLength(2)
      expect(layerOf(baseTiledMap(), 'Seats').id).toBe(8)
    })
  })
})
