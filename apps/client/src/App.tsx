import type { CSSProperties } from 'react'
import { PhaserGame } from './game/PhaserGame.tsx'
import { Hud } from './ui/Hud.tsx'

const appStyle: CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '100%',
  overflow: 'hidden',
}

export function App() {
  return (
    <div style={appStyle}>
      <PhaserGame />
      <Hud />
    </div>
  )
}
