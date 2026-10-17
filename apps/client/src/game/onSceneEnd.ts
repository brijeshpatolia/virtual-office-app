import Phaser from 'phaser'

// scene.stop() emits SHUTDOWN, but scene.remove() and game.destroy() emit only DESTROY.
// Runs the cleanup once, on whichever comes first.
export function onSceneEnd(scene: Phaser.Scene, cleanup: () => void): void {
  const { events } = scene
  const run = (): void => {
    events.off(Phaser.Scenes.Events.SHUTDOWN, run)
    events.off(Phaser.Scenes.Events.DESTROY, run)
    cleanup()
  }
  events.once(Phaser.Scenes.Events.SHUTDOWN, run)
  events.once(Phaser.Scenes.Events.DESTROY, run)
}
