import type { CSSProperties } from 'react'
import { PhaserGame } from './game/PhaserGame.tsx'

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
      {/* HUD overlays (chat bar, media dock, prompts) go here, absolutely positioned. */}
    </div>
  )
}
