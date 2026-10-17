import Phaser from 'phaser'
import { useLayoutEffect, useRef, type CSSProperties } from 'react'
import { createGameConfig } from './config.ts'

const containerStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  overflow: 'hidden',
}

export function PhaserGame() {
  const containerRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const parent = containerRef.current
    if (!parent) return

    const game = new Phaser.Game(createGameConfig(parent))

    return () => {
      // destroy() only runs on Phaser's next frame. Detach the canvas now so a
      // StrictMode or HMR remount never shows two canvases at once.
      game.canvas.remove()
      game.destroy(true)
    }
  }, [])

  return <div ref={containerRef} style={containerStyle} />
}
