import type { Application } from 'express'
import type { RouteDeps } from './routes.ts'

// The P2 routes (packages/shared/src/protocol/http.ts), registered at the end of registerRoutes, so the /api origin
// check and Cache-Control: no-store apply. Use signedInWith, officeOfRoute and sendError from routes.ts.
//   GET /api/offices/:officeId/chat          members and guests       -> ChatHistoryResponse (deps.services.chat.list)
//   GET /api/offices/:officeId/chat/unread   members and guests       -> ChatUnreadResponse (deps.services.chat.unread)
//   GET /api/offices/:officeId/members       not guests (403)         -> MembersResponse
//   GET /api/me/prefs?orgId=                 members of orgId (else 404) -> UserPrefsResponse (deps.services.prefs.get)
//   PUT /api/me/prefs?orgId=                 members of orgId (else 404) -> UserPrefsResponse (deps.services.prefs.update)
export function registerChatRoutes(app: Application, deps: RouteDeps): void {
  void app
  void deps
}
