import Phaser from 'phaser'
import { OfficeScene } from './scenes/OfficeScene.ts'

export function createGameConfig(parent: HTMLElement): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#CFF5FC',
    pixelArt: true,
    scale: {
      mode: Phaser.Scale.ScaleModes.RESIZE,
      parent,
      width: '100%',
      height: '100%',
    },
    physics: {
      default: 'arcade',
      arcade: { gravity: { x: 0, y: 0 }, debug: false },
    },
    scene: [OfficeScene],
  }
}

// StrictMode Fast Refresh does not re-run PhaserGame's [] effect, so a hot update would keep the old game running.
// Reload the page when this module or anything it imports (scenes, @vo/shared) changes.
// An edit to PhaserGame.tsx itself still keeps the old game until you reload.
import.meta.hot?.accept(() => window.location.reload())
