// Extra parts of window.__voOffice.snapshot() that live outside the scene (the chat bar registers chat()).
export interface ChatDebug {
  // Loaded message ids, oldest first, and the messages still on their way.
  ids: string[]
  pending: number
  unread: number
  mentions: number
}

export const debugExtras: { chat?: () => ChatDebug } = {}
