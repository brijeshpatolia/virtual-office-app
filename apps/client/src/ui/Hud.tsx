import { DebugHint } from './DebugHint.tsx'
import { hudStyle } from './hudStyles.ts'
import { SeatHint } from './SeatHint.tsx'
import { Toasts } from './Toasts.tsx'
import { ZoneLabel } from './ZoneLabel.tsx'

export function Hud() {
  return (
    <>
      <Toasts />
      <div style={hudStyle}>
        <SeatHint />
        <ZoneLabel />
        <DebugHint />
      </div>
    </>
  )
}
