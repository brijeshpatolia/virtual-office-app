import { describe, expect, it } from 'vitest'
import { cameraBounds, fitZoom, followZoom } from './cameraFit.ts'

const map = { width: 1280, height: 960 }

describe('fitZoom', () => {
  it('uses the largest whole zoom that fits', () => {
    expect(fitZoom({ width: 1920, height: 1080 }, map)).toBe(1)
    expect(fitZoom({ width: 2560, height: 1920 }, map)).toBe(2)
    expect(fitZoom({ width: 3900, height: 2900 }, map)).toBe(3)
  })

  it('uses a fractional fit when 1x does not fit', () => {
    expect(fitZoom({ width: 1280, height: 800 }, map)).toBeCloseTo(800 / 960)
  })

  it('falls back to 1 for an empty view', () => {
    expect(fitZoom({ width: 0, height: 0 }, map)).toBe(1)
  })
})

describe('cameraBounds', () => {
  it('keeps the map bounds when the map fills the view', () => {
    expect(cameraBounds({ width: 1280, height: 960 }, map, 1)).toEqual({ x: 0, y: 0, ...map })
  })

  it('grows the bounds around the map centre when the view is larger', () => {
    expect(cameraBounds({ width: 1920, height: 1080 }, map, 1)).toEqual({
      x: -320,
      y: -60,
      width: 1920,
      height: 1080,
    })
  })
})

describe('followZoom', () => {
  it('uses zoom 2 on desktop windows and 1 on small screens', () => {
    expect(followZoom({ width: 1920, height: 1000 })).toBe(2)
    expect(followZoom({ width: 1280, height: 640 })).toBe(2)
    expect(followZoom({ width: 800, height: 1000 })).toBe(1)
    expect(followZoom({ width: 390, height: 780 })).toBe(1)
  })
})
