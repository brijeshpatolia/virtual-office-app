import type { OfficeMap } from '@vo/shared'

// 'meeting-room' -> 'Meeting room', 'pod-a' -> 'Pod A'.
export function zoneLabel(zoneId: string): string {
  const words = zoneId.split(/[-_\s]+/).filter((word) => word !== '')
  return words
    .map((word, i) => (word.length === 1 ? word.toUpperCase() : i === 0 ? word[0]?.toUpperCase() + word.slice(1) : word))
    .join(' ')
}

// The toast for a change of the local player's server zone; null when there is nothing to say
// ('' = between zones, e.g. in a doorway).
export function zoneToastText(map: Pick<OfficeMap, 'zones'>, previous: string, next: string): string | null {
  if (next === '' || next === previous) return null
  const zone = map.zones.find((z) => z.id === next)
  const label = `Entered ${zoneLabel(next)}`
  return zone?.mediaMode === 'room' ? `${label} (group call later)` : label
}
