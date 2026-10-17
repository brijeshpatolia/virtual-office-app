// ?debug=1 shows the map debug overlay at start.
export function mapDebugFromQuery(search: string): boolean {
  return new URLSearchParams(search).get('debug') === '1'
}

export const MAP_DEBUG_KEY_CODE = 'Backquote'
