import { useEffect, useState } from 'react'
import { EventBus } from '../game/EventBus.ts'
import { kbdStyle, pillStyle } from './hudStyles.ts'

// 'E: sit', 'E: sit (computer)' or 'E: stand' while the own avatar is near a free seat or seated.
export function SeatHint() {
  const [hint, setHint] = useState<string | null>(null)

  useEffect(() => {
    EventBus.on('seat-hint', setHint)
    return () => {
      EventBus.off('seat-hint', setHint)
    }
  }, [])

  if (hint === null) return null
  const [key, ...rest] = hint.split(':')
  return (
    <div data-testid="seat-hint" style={pillStyle}>
      <kbd style={kbdStyle}>{key}</kbd>
      {rest.join(':')}
    </div>
  )
}
