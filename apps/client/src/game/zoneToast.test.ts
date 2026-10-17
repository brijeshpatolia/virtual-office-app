import { describe, expect, it } from 'vitest'
import type { ZoneDef } from '@vo/shared'
import { zoneLabel, zoneToastText } from './zoneToast.ts'

const zone = (id: string, mediaMode: ZoneDef['mediaMode']): ZoneDef => ({
  id,
  zoneType: 'meeting',
  mediaMode,
  capacity: 0,
  lockable: false,
  priority: 0,
  rect: { x: 0, y: 0, w: 1, h: 1 },
})
const map = { zones: [zone('meeting-room', 'room'), zone('open-plan', 'proximity'), zone('pod-a', 'proximity')] }

describe('zoneLabel', () => {
  it('turns zone ids into labels', () => {
    expect(zoneLabel('meeting-room')).toBe('Meeting room')
    expect(zoneLabel('pod-a')).toBe('Pod A')
    expect(zoneLabel('lobby')).toBe('Lobby')
    expect(zoneLabel('private_office')).toBe('Private office')
  })
})

describe('zoneToastText', () => {
  it('announces a new zone, with a note for room-mode zones', () => {
    expect(zoneToastText(map, 'lobby', 'meeting-room')).toBe('Entered Meeting room (group call later)')
    expect(zoneToastText(map, 'open-plan', 'pod-a')).toBe('Entered Pod A')
    expect(zoneToastText(map, 'pod-a', 'open-plan')).toBe('Entered Open plan')
  })

  it('says nothing for the same zone or no zone', () => {
    expect(zoneToastText(map, 'pod-a', 'pod-a')).toBeNull()
    expect(zoneToastText(map, 'lobby', '')).toBeNull()
  })
})
