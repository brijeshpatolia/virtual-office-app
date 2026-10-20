import { forOrg } from '@vo/db'
import {
  API,
  ChatHistoryQuerySchema,
  PrefsQuerySchema,
  UpdatePrefsRequestSchema,
  type ChatHistoryResponse,
  type ChatUnreadResponse,
  type MembersResponse,
  type UserPrefsResponse,
} from '@vo/shared'
import type { Application, Request, Response } from 'express'
import { toOrgRole } from '../auth/access.ts'
import { displayName, officeOfRoute, sendError, signedInWith, type RouteDeps } from './routes.ts'

// The P2 routes (packages/shared/src/protocol/http.ts), registered at the end of registerRoutes, so the /api origin
// check and Cache-Control: no-store apply. Office routes answer 404 to everyone outside the office's company.
//   GET /api/offices/:officeId/chat          members and guests       -> ChatHistoryResponse
//   GET /api/offices/:officeId/chat/unread   members and guests       -> ChatUnreadResponse
//   GET /api/offices/:officeId/members       not guests (403)         -> MembersResponse
//   GET /api/me/prefs?orgId=                 members of orgId (else 404) -> UserPrefsResponse
//   PUT /api/me/prefs?orgId=                 members of orgId (else 404) -> UserPrefsResponse
export function registerChatRoutes(app: Application, deps: RouteDeps): void {
  const { db, auth, getOfficeAccess, services } = deps
  const signedIn = signedInWith(auth)
  const officeOf = (req: Request, res: Response, userId: string) => officeOfRoute(getOfficeAccess, req, res, userId)

  app.get(
    '/api/offices/:officeId/chat',
    signedIn(async (req, res, { user }) => {
      const office = await officeOf(req, res, user.id)
      if (!office) return
      const query = ChatHistoryQuerySchema.safeParse(req.query)
      if (!query.success) return sendError(res, 'invalid_request')
      const page = await services.chat.list(office, { userId: user.id, role: office.role }, query.data)
      res.json(page satisfies ChatHistoryResponse)
    }),
  )

  app.get(
    '/api/offices/:officeId/chat/unread',
    signedIn(async (req, res, { user }) => {
      const office = await officeOf(req, res, user.id)
      if (!office) return
      res.json((await services.chat.unread(office, { userId: user.id, role: office.role })) satisfies ChatUnreadResponse)
    }),
  )

  app.get(
    '/api/offices/:officeId/members',
    signedIn(async (req, res, { user }) => {
      const office = await officeOf(req, res, user.id)
      if (!office) return
      if (office.role === 'guest') return sendError(res, 'forbidden')
      const members = await forOrg(db, office.orgId).listMembers()
      res.json({
        members: members.flatMap((m) => {
          const role = toOrgRole(m.role)
          return role === null ? [] : [{ userId: m.userId, name: displayName(m), role, joinedAt: m.joinedAt.toISOString() }]
        }),
      } satisfies MembersResponse)
    }),
  )

  // The caller's membership of ?orgId= (404 otherwise, so company ids do not leak); null after an answer was sent.
  const prefsOrg = async (req: Request, res: Response, userId: string): Promise<string | null> => {
    const query = PrefsQuerySchema.safeParse(req.query)
    if (!query.success) {
      sendError(res, 'invalid_request')
      return null
    }
    const found = await forOrg(db, query.data.orgId).findMember(userId)
    if (found === null || toOrgRole(found.role) === null) {
      sendError(res, 'not_found')
      return null
    }
    return query.data.orgId
  }

  app.get(
    API.me + '/prefs',
    signedIn(async (req, res, { user }) => {
      const orgId = await prefsOrg(req, res, user.id)
      if (orgId === null) return
      res.json({ orgId, ...(await services.prefs.get(orgId, user.id)) } satisfies UserPrefsResponse)
    }),
  )

  app.put(
    API.me + '/prefs',
    signedIn(async (req, res, { user }) => {
      const orgId = await prefsOrg(req, res, user.id)
      if (orgId === null) return
      const body = UpdatePrefsRequestSchema.safeParse(req.body)
      if (!body.success) return sendError(res, 'invalid_request')
      const result = await services.prefs.update(orgId, user.id, body.data)
      if (!result.ok) return sendError(res, 'invalid_request')
      res.json({ orgId, ...result.prefs } satisfies UserPrefsResponse)
    }),
  )
}
