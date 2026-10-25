import type { CSSProperties } from 'react'
import { COLORS } from '../ui/pageStyles.ts'

export const chatFont = 'system-ui, -apple-system, "Segoe UI", sans-serif'

export const barStyle: CSSProperties = {
  flex: '0 0 auto',
  position: 'relative',
  borderTop: `1px solid ${COLORS.line}`,
  background: '#ffffff',
  color: COLORS.ink,
  fontFamily: chatFont,
  fontSize: 14,
}

export const barLineStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 36,
  padding: '0 8px',
  boxSizing: 'border-box',
}

export const smallButtonStyle: CSSProperties = {
  padding: '4px 8px',
  border: `1px solid ${COLORS.line}`,
  borderRadius: 6,
  background: '#ffffff',
  color: COLORS.ink,
  fontFamily: chatFont,
  fontSize: 13,
  cursor: 'pointer',
}

export const linkLikeStyle: CSSProperties = {
  padding: 0,
  border: 'none',
  background: 'none',
  color: 'inherit',
  font: 'inherit',
  fontWeight: 600,
  cursor: 'pointer',
}

export const badgeStyle: CSSProperties = {
  minWidth: 18,
  padding: '1px 6px',
  borderRadius: 9,
  background: COLORS.accent,
  color: '#ffffff',
  fontSize: 12,
  fontWeight: 700,
  textAlign: 'center',
  boxSizing: 'border-box',
}

export const mentionBadgeStyle: CSSProperties = { ...badgeStyle, background: '#c62828' }

// A column whose first child has marginTop auto: a short history sits at the bottom, next to the input.
export const listStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: 'min(220px, 32vh)',
  overflowY: 'auto',
  overflowAnchor: 'none',
  padding: '4px 8px',
  boxSizing: 'border-box',
  borderTop: `1px solid ${COLORS.line}`,
}

export const rowStyle: CSSProperties = {
  position: 'relative',
  padding: '3px 6px',
  borderRadius: 6,
  lineHeight: 1.4,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
}

export const mentionRowStyle: CSSProperties = { ...rowStyle, background: '#fff4cc' }

export const metaStyle: CSSProperties = { color: COLORS.muted, fontSize: 12, marginLeft: 6 }

export const mentionStyle: CSSProperties = { color: COLORS.accent, fontWeight: 600 }

export const selfMentionStyle: CSSProperties = { ...mentionStyle, background: '#ffe08a', color: COLORS.ink, borderRadius: 3, padding: '0 2px' }

export const noteStyle: CSSProperties = { color: COLORS.muted, fontSize: 13, fontStyle: 'italic' }

export const errorStyle: CSSProperties = { color: COLORS.danger, fontSize: 13 }

export const composerStyle: CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'flex-end',
  gap: 8,
  padding: '6px 8px 8px',
  boxSizing: 'border-box',
}

export const textareaStyle: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  resize: 'none',
  maxHeight: 120,
  padding: '7px 10px',
  border: `1px solid ${COLORS.line}`,
  borderRadius: 8,
  fontFamily: chatFont,
  fontSize: 14,
  lineHeight: 1.4,
  color: COLORS.ink,
  background: '#ffffff',
  boxSizing: 'border-box',
}

export const sendButtonStyle: CSSProperties = {
  padding: '7px 14px',
  border: 'none',
  borderRadius: 8,
  background: COLORS.accent,
  color: '#ffffff',
  fontFamily: chatFont,
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
}

export const suggestionsStyle: CSSProperties = {
  position: 'absolute',
  left: 8,
  bottom: '100%',
  zIndex: 5,
  minWidth: 200,
  maxWidth: 'calc(100% - 16px)',
  margin: 0,
  padding: 4,
  listStyle: 'none',
  borderRadius: 8,
  background: '#ffffff',
  boxShadow: '0 6px 24px rgba(20, 24, 32, 0.25)',
}

export const suggestionStyle = (active: boolean): CSSProperties => ({
  padding: '5px 8px',
  borderRadius: 6,
  cursor: 'pointer',
  background: active ? '#e3ecff' : 'transparent',
})
