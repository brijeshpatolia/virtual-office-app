import type { Db } from '@vo/db'
import { createPrefsService, type PrefsService } from '../presence/prefs.ts'
import { createChatService, type ChatService } from './chatService.ts'
import { createModeration, type Moderation } from './moderation.ts'

// The P2 services, one set per server process, shared by the /api routes and every office room.
export interface Services {
  chat: ChatService
  prefs: PrefsService
  moderation: Moderation
}

// now: the wall clock in ms (message times, mutes, the chat rate limit); tests pass a fake one.
export function createServices(db: Db, options: { now?: () => number } = {}): Services {
  const now = options.now ?? Date.now
  const prefs = createPrefsService(db, now)
  const moderation = createModeration({ db, now })
  return { prefs, moderation, chat: createChatService({ db, prefs, moderation, now }) }
}
