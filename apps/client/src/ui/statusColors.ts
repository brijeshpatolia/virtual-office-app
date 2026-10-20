import type { PlayerStatus } from '@vo/shared'

// Status colours for the avatar dot (Phaser) and the panels (CSS). DND also shows a white bar.
export const STATUS_COLOR: Record<PlayerStatus, string> = {
  available: '#3ccf6e',
  busy: '#e5484d',
  dnd: '#c62828',
  away: '#f2a33a',
}

export const OFFLINE_COLOR = '#9aa3b2'

export const statusColorNumber = (status: PlayerStatus): number => Number.parseInt(STATUS_COLOR[status].slice(1), 16)
