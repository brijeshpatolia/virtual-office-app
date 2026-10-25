import type { CSSProperties } from 'react'
import { headerFont } from '../office/headerStyles.ts'
import { COLORS } from '../ui/pageStyles.ts'

export const popoverStyle: CSSProperties = {
  position: 'absolute',
  zIndex: 15,
  boxSizing: 'border-box',
  padding: 12,
  borderRadius: 8,
  background: '#ffffff',
  color: COLORS.ink,
  boxShadow: '0 8px 30px rgba(20, 24, 32, 0.25)',
  fontFamily: headerFont,
  fontSize: 13,
  whiteSpace: 'normal',
}

export const panelButtonStyle: CSSProperties = {
  padding: '5px 10px',
  border: `1px solid ${COLORS.line}`,
  borderRadius: 6,
  background: '#ffffff',
  color: COLORS.ink,
  fontFamily: headerFont,
  fontSize: 13,
  cursor: 'pointer',
}

export const dangerButtonStyle: CSSProperties = { ...panelButtonStyle, color: COLORS.danger }

export const mutedTextStyle: CSSProperties = { color: COLORS.muted }

export const fieldStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '6px 8px',
  border: `1px solid ${COLORS.line}`,
  borderRadius: 6,
  fontFamily: headerFont,
  fontSize: 13,
  color: COLORS.ink,
  background: '#ffffff',
}

export const disabledStyle = (style: CSSProperties, isDisabled: boolean): CSSProperties =>
  isDisabled ? { ...style, opacity: 0.5, cursor: 'default' } : style
