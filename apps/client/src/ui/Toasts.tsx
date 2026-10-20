import { useEffect, useState, type CSSProperties } from 'react'
import { EventBus, type ToastKind } from '../game/EventBus.ts'
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

// Short messages from the game ('Entered Meeting room (group call later)') and the office ('Ann waved at you'),
// each shown for a moment.
export function Toasts() {
  const [toasts, setToasts] = useState<Array<{ id: number; text: string; kind: ToastKind }>>([])

  useEffect(() => {
    let nextId = 0
    const timers = new Set<number>()
    const add = (text: string, kind: ToastKind = 'info'): void => {
      const id = ++nextId
      setToasts((list) => [...list.slice(1 - MAX), { id, text, kind }])
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
        <div key={toast.id} data-testid={toast.kind === 'wave' ? 'wave-toast' : 'toast'} style={pillStyle}>
          {toast.text}
        </div>
      ))}
    </div>
  )
}
