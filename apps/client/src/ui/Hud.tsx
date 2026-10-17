import { DebugHint } from './DebugHint.tsx'
import { hudStyle } from './hudStyles.ts'
import { ZoneLabel } from './ZoneLabel.tsx'

export function Hud() {
  return (
    <div style={hudStyle}>
      <ZoneLabel />
      <DebugHint />
    </div>
  )
}
