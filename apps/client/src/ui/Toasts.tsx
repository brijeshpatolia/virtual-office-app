import { useEffect, useState, type CSSProperties } from 'react'
import { EventBus } from '../game/EventBus.ts'
import { pillStyle } from './hudStyles.ts'

const SHOW_MS = 2600
const MAX = 3

const stackStyle: CSSProperties = {
  position: 'absolute',
  top: 12,
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 6,
  pointerEvents: 'none',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
}

// Short messages from the game ('Entered Meeting room (group call later)'), each shown for a moment.
export function Toasts() {
  const [toasts, setToasts] = useState<Array<{ id: number; text: string }>>([])

  useEffect(() => {
    let nextId = 0
    const timers = new Set<number>()
    const add = (text: string): void => {
      const id = ++nextId
      setToasts((list) => [...list.slice(1 - MAX), { id, text }])
      const timer = window.setTimeout(() => {
        timers.delete(timer)
        setToasts((list) => list.filter((t) => t.id !== id))
      }, SHOW_MS)
      timers.add(timer)
    }
    EventBus.on('toast', add)
    return () => {
      EventBus.off('toast', add)
      for (const timer of timers) window.clearTimeout(timer)
    }
  }, [])

  return (
    <div style={stackStyle} aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} data-testid="toast" style={pillStyle}>
          {toast.text}
        </div>
      ))}
    </div>
  )
}
