import type { CSSProperties } from 'react'

export const hudStyle: CSSProperties = {
  position: 'absolute',
  left: 12,
  bottom: 12,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 6,
  // The HUD must not swallow the pointer events that the map uses for hover.
  pointerEvents: 'none',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  userSelect: 'none',
}

export const pillStyle: CSSProperties = {
  padding: '4px 10px',
  borderRadius: 6,
  background: 'rgba(20, 24, 32, 0.82)',
  color: '#ffffff',
  fontSize: 14,
  fontWeight: 600,
  lineHeight: 1.3,
}

export const hintStyle: CSSProperties = {
  ...pillStyle,
  padding: '3px 8px',
  background: 'rgba(20, 24, 32, 0.6)',
  fontSize: 12,
  fontWeight: 400,
}

export const kbdStyle: CSSProperties = {
  display: 'inline-block',
  minWidth: 10,
  padding: '0 4px',
  border: '1px solid rgba(255, 255, 255, 0.5)',
  borderRadius: 3,
  fontFamily: 'ui-monospace, monospace',
  textAlign: 'center',
}
