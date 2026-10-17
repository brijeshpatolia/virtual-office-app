export interface Size {
  width: number
  height: number
}

export interface Rect extends Size {
  x: number
  y: number
}

// Largest whole zoom that shows the full map; a fractional fit only when even 1x is too big.
export function fitZoom(view: Size, map: Size): number {
  const fit = Math.min(view.width / map.width, view.height / map.height)
  if (!(fit > 0) || !Number.isFinite(fit)) return 1
  return fit >= 1 ? Math.floor(fit) : fit
}

// Phaser clamps the camera to the top-left of bounds that are smaller than the view.
// Grow the bounds to the view size around the map centre so the map stays centred.
export function cameraBounds(view: Size, map: Size, zoom: number): Rect {
  const width = Math.max(map.width, view.width / zoom)
  const height = Math.max(map.height, view.height / zoom)
  return {
    x: Math.floor((map.width - width) / 2),
    y: Math.floor((map.height - height) / 2),
    width,
    height,
  }
}

// Zoom while following the own avatar: 2 on typical desktop windows, 1 on small screens.
export const FOLLOW_ZOOM_2_MIN = { width: 900, height: 560 } as const

export function followZoom(view: Size): number {
  return view.width >= FOLLOW_ZOOM_2_MIN.width && view.height >= FOLLOW_ZOOM_2_MIN.height ? 2 : 1
}
