// ?debug=1 shows the map debug overlay at start.
export function mapDebugFromQuery(search: string): boolean {
  return new URLSearchParams(search).get('debug') === '1'
}

// The key left of 1 (code Backquote) on every layout, or a typed backquote wherever it lives.
// event.key alone fails on dead-key layouts (e.g. German), which report "Dead" for the backquote.
export function isMapDebugKey(event: Pick<KeyboardEvent, 'code' | 'key'>): boolean {
  return event.code === 'Backquote' || event.key === '`'
}
