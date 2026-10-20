import { COLYSEUS_PATH } from '@vo/shared'

// Unset (dev, same-origin deploys): the API is on this origin and Vite forwards /api and /colyseus.
// Set (P1b, split origins): the API is `${VITE_SERVER_URL}/api/...` and Colyseus is VITE_SERVER_URL itself.
export const SERVER_URL = (import.meta.env.VITE_SERVER_URL ?? '').replace(/\/+$/, '')

export const apiUrl = (path: string): string => `${SERVER_URL}${path}`

export const colyseusEndpoint = (): string => SERVER_URL || `${window.location.origin}${COLYSEUS_PATH}`
