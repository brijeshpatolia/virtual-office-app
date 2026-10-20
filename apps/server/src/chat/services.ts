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

export function createServices(db: Db): Services {
  const prefs = createPrefsService(db)
  const moderation = createModeration({ db })
  return { prefs, moderation, chat: createChatService({ db, prefs, moderation }) }
}
