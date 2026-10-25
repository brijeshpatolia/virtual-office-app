import { findInviteLinkByTokenHash, forOrg, forUser, isInviteLinkUsable, type Db } from '@vo/db'
import {
  ACCESS_TOKEN_TTL_MS,
  API,
  API_ERRORS,
  CLIENT_ROUTES,
  CreateCompanyRequestSchema,
  CreateInviteLinkRequestSchema,
  NAME_MAX_LENGTH,
  RtTokenQuerySchema,
  TEMPLATE_ID,
  type AcceptInviteLinkResponse,
  type ApiErrorCode,
  type ClientConfigResponse,
  type CreateCompanyResponse,
  type CreateInviteLinkResponse,
  type InviteLinkInfoResponse,
  type ListInviteLinksResponse,
  type MeResponse,
  type OfficeResponse,
  type RevokeInviteLinkResponse,
  type RtTokenResponse,
} from '@vo/shared'
import { isAPIError } from 'better-auth/api'
import { fromNodeHeaders } from 'better-auth/node'
import type { Application, Request, RequestHandler, Response } from 'express'
import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { can, toOrgRole } from '../auth/access.ts'
import type { Auth } from '../auth/auth.ts'
import type { GetOfficeAccess, OfficeAccess } from '../auth/membership.ts'
import { ACCESS_TOKEN_AUDIENCE } from '../auth/verifyAccessToken.ts'
import type { Services } from '../chat/services.ts'
import type { Env } from '../env.ts'
import type { Mailer } from '../mail/mailer.ts'
import { registerChatRoutes } from './chatRoutes.ts'

export interface RouteDeps {
  env: Env
  db: Db
  auth: Auth
  mailer: Mailer
  getOfficeAccess: GetOfficeAccess
  services: Services
}

export const TEMPLATE_VERSION = 1
export const DEFAULT_INVITE_LINK_HOURS = 168

export type Session = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>
export type SessionHandler = (req: Request, res: Response, session: Session) => Promise<void>

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
export const IdSchema = z.string().min(1).max(64)

// Wraps a handler that needs a signed-in user (401 unauthorized otherwise).
export function signedInWith(auth: Auth): (handler: SessionHandler) => RequestHandler {
  return (handler) => async (req, res) => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) })
    if (!session) return sendError(res, 'unauthorized')
    await handler(req, res, session)
  }
}

export type RouteOffice = OfficeAccess & { officeId: string }

// The office of the route (:officeId) and the caller's access to it; null (404 sent) when the caller is not a
// member, so office ids do not leak.
export async function officeOfRoute(
  getOfficeAccess: GetOfficeAccess,
  req: Request,
  res: Response,
  userId: string,
): Promise<RouteOffice | null> {
  const officeId = IdSchema.safeParse(req.params.officeId)
  const access = officeId.success ? await getOfficeAccess(userId, officeId.data) : null
  if (!access || !officeId.success) {
    sendError(res, 'not_found')
    return null
  }
  return { officeId: officeId.data, ...access }
}

// randomBytes(32) in base64url.
const InviteTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)

// The /api routes of the HTTP contract (packages/shared/src/protocol/http.ts), except /api/auth/* (Better Auth).
// Runs after express.json(); server.ts adds the JSON 404 and error handlers after these routes.
// Every tenant query goes through forOrg(orgId) with the orgId of an office the caller is a member of
// (getOfficeAccess), or of the invite link the caller holds.
export function registerRoutes(app: Application, deps: RouteDeps): void {
  const { env, db, auth, getOfficeAccess } = deps
  const signedIn = signedInWith(auth)

  const findInvite = async (token: unknown) => {
    const parsed = InviteTokenSchema.safeParse(token)
    return parsed.success ? findInviteLinkByTokenHash(db, hashToken(parsed.data)) : null
  }

  // The session cookie is SameSite=Lax; on top of that, a state change must come from the client origin.
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store')
    if (!SAFE_METHODS.has(req.method) && req.get('origin') !== env.CLIENT_ORIGIN) return sendError(res, 'forbidden', 'origin')
    next()
  })

  // Public: the client shows the Google button only when Google sign-in is configured.
  app.get(API.config, (_req, res) => {
    res.json({ google: env.google !== undefined } satisfies ClientConfigResponse)
  })

  app.get(
    API.me,
    signedIn(async (_req, res, { user }) => {
      const me = forUser(db, user.id)
      const [memberships, offices] = await Promise.all([me.memberships(), me.offices()])
      const orgs = memberships.flatMap((m) => {
        const role = toOrgRole(m.role)
        return role ? [{ id: m.orgId, name: m.name, slug: m.slug, role }] : []
      })
      const orgIds = new Set(orgs.map((org) => org.id))
      res.json({
        user: { id: user.id, name: user.name, email: user.email, image: user.image ?? null },
        orgs,
        offices: offices.filter((office) => orgIds.has(office.orgId)).map(({ id, orgId, name }) => ({ id, orgId, name })),
      } satisfies MeResponse)
    }),
  )

  app.post(
    API.companies,
    signedIn(async (req, res, { user }) => {
      const body = CreateCompanyRequestSchema.safeParse(req.body)
      if (!body.success) return sendError(res, 'invalid_request')
      const { companyName, officeName } = body.data
      // The caller becomes the owner, and the company becomes the session's active organization.
      const org = await auth.api
        .createOrganization({ body: { name: companyName, slug: slugFor(companyName) }, headers: fromNodeHeaders(req.headers) })
        .catch((error: unknown) => {
          if (isAPIError(error) && error.body?.code === 'YOU_HAVE_REACHED_THE_MAXIMUM_NUMBER_OF_ORGANIZATIONS') return null
          throw error
        })
      if (org === null) return sendError(res, 'forbidden', 'company_limit')
      const tenant = forOrg(db, org.id)
      const office = await tenant.createOffice({ name: officeName, templateId: TEMPLATE_ID, templateVersion: TEMPLATE_VERSION }).catch(
        async (error: unknown) => {
          await tenant.deleteOrganization()
          throw error
        },
      )
      await tenant.audit({ actorId: user.id, action: 'company.create', targetType: 'office', targetId: office.id })
      res.status(201).json({ orgId: org.id, officeId: office.id } satisfies CreateCompanyResponse)
    }),
  )

  app.get(
    '/api/offices/:officeId',
    signedIn(async (req, res, { user }) => {
      const officeId = IdSchema.safeParse(req.params.officeId)
      const access = officeId.success ? await getOfficeAccess(user.id, officeId.data) : null
      const office = access && officeId.success ? await forOrg(db, access.orgId).getOffice(officeId.data) : null
      // 404 for everyone outside the company, so office ids do not leak.
      if (!access || !office) return sendError(res, 'not_found')
      const { id, orgId, name, templateId, templateVersion } = office
      res.json({ office: { id, orgId, name, templateId, templateVersion }, role: access.role } satisfies OfficeResponse)
    }),
  )

  const officeOf = (req: Request, res: Response, userId: string) => officeOfRoute(getOfficeAccess, req, res, userId)

  app.get(
    '/api/offices/:officeId/invite-links',
    signedIn(async (req, res, { user }) => {
      const office = await officeOf(req, res, user.id)
      if (!office) return
      if (!can(office.role, 'invite')) return sendError(res, 'forbidden')
      const links = await forOrg(db, office.orgId).listActiveInviteLinks(office.officeId)
      res.json({
        links: links.map((link) => ({
          id: link.id,
          role: link.role,
          uses: link.uses,
          maxUses: link.maxUses,
          expiresAt: link.expiresAt.toISOString(),
          createdAt: link.createdAt.toISOString(),
          createdBy: displayName({ name: link.creatorName, email: '' }),
        })),
      } satisfies ListInviteLinksResponse)
    }),
  )

  app.delete(
    '/api/offices/:officeId/invite-links/:linkId',
    signedIn(async (req, res, { user }) => {
      const office = await officeOf(req, res, user.id)
      if (!office) return
      if (!can(office.role, 'invite')) return sendError(res, 'forbidden')
      const linkId = IdSchema.safeParse(req.params.linkId)
      const tenant = forOrg(db, office.orgId)
      if (!linkId.success || !(await tenant.revokeInviteLink(office.officeId, linkId.data))) return sendError(res, 'not_found')
      await tenant.audit({ actorId: user.id, action: 'invite_link.revoke', targetType: 'invite_link', targetId: linkId.data })
      res.json({ id: linkId.data, revoked: true } satisfies RevokeInviteLinkResponse)
    }),
  )

  app.post(
    '/api/offices/:officeId/invite-links',
    signedIn(async (req, res, { user }) => {
      const office = await officeOf(req, res, user.id)
      if (!office) return
      const { officeId, ...access } = office
      if (!can(access.role, 'invite')) return sendError(res, 'forbidden')
      const body = CreateInviteLinkRequestSchema.safeParse(req.body)
      if (!body.success) return sendError(res, 'invalid_request')

      const token = randomBytes(32).toString('base64url')
      const { role, maxUses } = body.data
      const expiresAt = new Date(Date.now() + (body.data.expiresInHours ?? DEFAULT_INVITE_LINK_HOURS) * 3_600_000)
      const tenant = forOrg(db, access.orgId)
      const link = await tenant.createInviteLink({
        officeId,
        tokenHash: hashToken(token),
        role,
        maxUses: maxUses ?? null,
        expiresAt,
        createdBy: user.id,
      })
      await tenant.audit({
        actorId: user.id,
        action: 'invite_link.create',
        targetType: 'invite_link',
        targetId: link.id,
        data: { role, maxUses: link.maxUses, expiresAt: expiresAt.toISOString() },
      })
      res.status(201).json({
        url: `${env.CLIENT_ORIGIN}${CLIENT_ROUTES.invite(token)}`,
        token,
        expiresAt: expiresAt.toISOString(),
      } satisfies CreateInviteLinkResponse)
    }),
  )

  app.get('/api/invite-links/:token', async (req, res) => {
    const found = await findInvite(req.params.token)
    if (!found) return sendError(res, 'not_found')
    res.json({
      companyName: found.companyName,
      officeName: found.officeName,
      role: found.link.role,
      valid: isInviteLinkUsable(found.link),
    } satisfies InviteLinkInfoResponse)
  })

  app.post(
    '/api/invite-links/:token/accept',
    signedIn(async (req, res, { user }) => {
      const found = await findInvite(req.params.token)
      if (!found) return sendError(res, 'not_found')
      const { link } = found
      const tenant = forOrg(db, link.orgId)
      const joined: AcceptInviteLinkResponse = { orgId: link.orgId, officeId: link.officeId }
      const isMember = async () => (await tenant.findMemberRole(user.id)) !== null

      if (await isMember()) {
        res.json(joined)
        return
      }
      if (await tenant.wasRemoved(user.id)) return sendError(res, 'forbidden', 'removed')
      if (!(await tenant.consumeInviteLink(link.id))) return sendError(res, 'invite_invalid')
      try {
        await auth.api.addMember({ body: { userId: user.id, role: link.role, organizationId: link.orgId } })
      } catch (error) {
        await tenant.releaseInviteLink(link.id)
        // A second accept of the same user that ran at the same time.
        if (await isMember()) {
          res.json(joined)
          return
        }
        if (isAPIError(error) && error.body?.code === 'ORGANIZATION_MEMBERSHIP_LIMIT_REACHED') {
          return sendError(res, 'forbidden', 'membership_limit')
        }
        throw error
      }
      await tenant.audit({ actorId: user.id, action: 'invite_link.accept', targetType: 'invite_link', targetId: link.id, data: { role: link.role } })
      res.json(joined)
    }),
  )

  app.get(
    '/api/rt-token',
    signedIn(async (req, res, { user }) => {
      const query = RtTokenQuerySchema.safeParse(req.query)
      if (!query.success) return sendError(res, 'invalid_request')
      const { officeId } = query.data
      const access = await getOfficeAccess(user.id, officeId)
      if (!access) return sendError(res, 'not_found')
      if (!can(access.role, 'enter')) return sendError(res, 'forbidden')

      const iat = Math.floor(Date.now() / 1000)
      const exp = iat + ACCESS_TOKEN_TTL_MS / 1000
      const payload = { sub: user.id, orgId: access.orgId, officeId, role: access.role, name: displayName(user), aud: ACCESS_TOKEN_AUDIENCE, iat, exp }
      const { token } = await auth.api.signJWT({ body: { payload } })
      res.json({ token, expiresAt: new Date(exp * 1000).toISOString() } satisfies RtTokenResponse)
    }),
  )

  registerChatRoutes(app, deps)
}

export function sendError(res: Response, error: ApiErrorCode, message?: string): void {
  res.status(API_ERRORS[error]).json(message === undefined ? { error } : { error, message })
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// Never empty and at most NAME_MAX_LENGTH characters: a new email-OTP user has name '' until they set one.
export function displayName(user: { name: string; email: string }): string {
  const name = user.name.trim() || user.email.split('@')[0] || 'Someone'
  return name.slice(0, NAME_MAX_LENGTH)
}

// Slugs are unique in Better Auth; the random part keeps two companies with the same name apart.
function slugFor(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return `${base || 'company'}-${randomBytes(4).toString('hex')}`
}
