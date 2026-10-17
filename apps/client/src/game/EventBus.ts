import Phaser from 'phaser'

// Single channel between React and Phaser.
export const EventBus = new Phaser.Events.EventEmitter()
