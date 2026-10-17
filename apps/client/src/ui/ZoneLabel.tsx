import { useEffect, useState } from 'react'
import { EventBus, type ZoneHover } from '../game/EventBus.ts'
import { pillStyle } from './hudStyles.ts'

// The zone under the mouse and its media mode, e.g. "meeting-room · room".
export function ZoneLabel() {
  const [zone, setZone] = useState<ZoneHover | null>(null)

  useEffect(() => {
    EventBus.on('zone-hover', setZone)
    return () => {
      EventBus.off('zone-hover', setZone)
    }
  }, [])

  if (zone === null) return null
  return (
    <div data-testid="zone-label" style={pillStyle}>
      {`${zone.zoneId} · ${zone.mediaMode}`}
    </div>
  )
}
