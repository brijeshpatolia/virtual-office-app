import { useEffect, useState } from 'react'
import { EventBus } from '../game/EventBus.ts'
import { mapDebugFromQuery } from '../game/debug/debugFlag.ts'
import { hintStyle, kbdStyle } from './hudStyles.ts'

export function DebugHint() {
  const [debugOn, setDebugOn] = useState(() => mapDebugFromQuery(window.location.search))

  useEffect(() => {
    EventBus.on('map-debug', setDebugOn)
    return () => {
      EventBus.off('map-debug', setDebugOn)
    }
  }, [])

  return (
    <div data-testid="debug-hint" style={hintStyle}>
      Press <kbd style={kbdStyle}>`</kbd> (the key left of 1) {debugOn ? 'to hide map debug' : 'for map debug'}
    </div>
  )
}
