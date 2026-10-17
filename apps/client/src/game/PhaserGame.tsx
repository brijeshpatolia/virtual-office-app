import Phaser from 'phaser'
import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react'
import { createGameConfig } from './config.ts'
import { EventBus } from './EventBus.ts'
import type { OfficeScene } from './scenes/OfficeScene.ts'

const containerStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  overflow: 'hidden',
}

// onReady: the office scene of this game finished create() (the map is drawn); attach the room to it then.
export function PhaserGame({ onReady }: { onReady?: (scene: OfficeScene | null) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const onReadyRef = useRef(onReady)

  useEffect(() => {
    onReadyRef.current = onReady
  })

  useLayoutEffect(() => {
    const parent = containerRef.current
    if (!parent) return

    const game = new Phaser.Game(createGameConfig(parent))
    const ready = (scene: OfficeScene): void => {
      if (scene.game === game) onReadyRef.current?.(scene)
    }
    EventBus.on('office-ready', ready)

    return () => {
      EventBus.off('office-ready', ready)
      onReadyRef.current?.(null)
      // destroy() only runs on Phaser's next frame. Detach the canvas now so the
      // StrictMode double mount never shows two canvases at once. Edits to Phaser
      // code reload the page (see config.ts) instead of remounting this component.
      game.canvas.remove()
      game.destroy(true)
    }
  }, [])

  return <div ref={containerRef} style={containerStyle} />
}
