import type { CSSProperties } from 'react'

const font = 'system-ui, -apple-system, "Segoe UI", sans-serif'

export const COLORS = {
  ink: '#141820',
  muted: '#5b6472',
  line: '#d6dbe3',
  accent: '#2f6fed',
  accentInk: '#ffffff',
  danger: '#c62828',
  page: '#cff5fc',
  card: '#ffffff',
} as const

// The body does not scroll (the office is full screen), so a page scrolls itself; margin: auto on the card
// centres it without cutting off the top on a short screen.
export const pageStyle: CSSProperties = {
  height: '100%',
  display: 'flex',
  padding: 16,
  boxSizing: 'border-box',
  background: COLORS.page,
  fontFamily: font,
  color: COLORS.ink,
  overflowY: 'auto',
}

export const cardStyle: CSSProperties = {
  margin: 'auto',
  width: '100%',
  maxWidth: 400,
  boxSizing: 'border-box',
  padding: 28,
  borderRadius: 12,
  background: COLORS.card,
  boxShadow: '0 8px 30px rgba(20, 24, 32, 0.12)',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
}

export const titleStyle: CSSProperties = { margin: 0, fontSize: 22, fontWeight: 700 }

export const textStyle: CSSProperties = { margin: 0, fontSize: 15, lineHeight: 1.45, color: COLORS.muted }

export const labelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14, fontWeight: 600 }

export const inputStyle: CSSProperties = {
  padding: '10px 12px',
  border: `1px solid ${COLORS.line}`,
  borderRadius: 8,
  fontSize: 16,
  fontFamily: font,
  color: COLORS.ink,
  background: '#fff',
}

export const buttonStyle: CSSProperties = {
  padding: '10px 14px',
  border: 'none',
  borderRadius: 8,
  background: COLORS.accent,
  color: COLORS.accentInk,
  fontSize: 15,
  fontWeight: 600,
  fontFamily: font,
  cursor: 'pointer',
}

export const secondaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: 'transparent',
  color: COLORS.accent,
  border: `1px solid ${COLORS.line}`,
}

export const linkButtonStyle: CSSProperties = {
  padding: 0,
  border: 'none',
  background: 'none',
  color: COLORS.accent,
  fontSize: 14,
  fontFamily: font,
  cursor: 'pointer',
  textAlign: 'left',
}

export const errorStyle: CSSProperties = { margin: 0, fontSize: 14, color: COLORS.danger }

export const disabled = (style: CSSProperties, isDisabled: boolean): CSSProperties =>
  isDisabled ? { ...style, opacity: 0.6, cursor: 'default' } : style
