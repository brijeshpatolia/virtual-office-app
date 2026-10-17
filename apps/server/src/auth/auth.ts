import { forOrg, forUser, schema, type Db } from '@vo/db'
import { API, CLIENT_ROUTES, NameSchema, ORG_ROLES } from '@vo/shared'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from 'better-auth/api'
import { emailOTP, jwt, organization } from 'better-auth/plugins'
import type { Env } from '../env.ts'
import type { Mailer } from '../mail/mailer.ts'
import { plainMailText } from '../mail/plainText.ts'
import { ac, can, isOrgRole, roles, toOrgRole } from './access.ts'
import { invalidateOfficeAccess } from './membership.ts'
import { SlidingQuota } from './quota.ts'

export interface AuthDeps {
  env: Env
  db: Db
  mailer: Mailer
}

export const OTP_EXPIRES_IN_S = 5 * 60
export const INVITATION_EXPIRES_IN_S = 48 * 3600
// Companies one user may own. Each company is created with its office (POST /api/companies).
export const MAX_OWNED_COMPANIES = 3
// Invitation mails (new and resent) per inviter, and per company and recipient address, in 24 h. The mail quota is
// shared by all companies (Resend), and sign-in codes must still go out.
export const INVITATION_MAILS_PER_INVITER = 20
export const INVITATION_MAILS_PER_RECIPIENT = 3
const DAY_MS = 24 * 3600_000

// Better Auth endpoints after which a cached office access may be wrong.
const MEMBERSHIP_CHANGES = new Set([
  '/organization/remove-member',
  '/organization/leave',
  '/organization/update-member-role',
  '/organization/delete',
  '/delete-user',
])

// The company directory: member emails and pending invitations. Guests (outside people) may not read it.
const DIRECTORY_PATHS = new Set(['/organization/list-members', '/organization/get-full-organization', '/organization/list-invitations'])

// Where each endpoint carries a display or company name in its body.
const NAME_FIELDS: Record<string, (body: Record<string, unknown>) => Record<string, unknown> | undefined> = {
  '/update-user': (body) => body,
  '/sign-in/email-otp': (body) => body,
  '/organization/create': (body) => body,
  '/organization/update': (body) => (isRecord(body.data) ? body.data : undefined),
}

// Behind the Vite dev proxy no request carries a client IP, so every user shares one rate-limit bucket. Allow more
// than Better Auth's 3 codes per minute and 3 sign-ins per 10 s there (several test users, e2e runs).
const DEV_RATE_LIMITS = {
  '/email-otp/send-verification-otp': { window: 60, max: 30 },
  '/sign-in/*': { window: 10, max: 30 },
}
const RATE_LIMITS = { '/organization/invite-member': { window: 60, max: 10 } }

type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0]

// The Better Auth instance: email OTP (no passwords), Google when configured, companies as organizations with the
// roles owner, admin, member and guest, email invitations, and the EdDSA keys that sign the realtime token
// (GET /api/rt-token in http/routes.ts).
export function createAuth({ env, db, mailer }: AuthDeps) {
  const invitationMails = new SlidingQuota(DAY_MS)

  // A trimmed name of at most NAME_MAX_LENGTH characters on one line, or 400. Sign-in may leave it empty.
  const checkName = (ctx: HookContext): void => {
    const holder = isRecord(ctx.body) ? NAME_FIELDS[ctx.path]?.(ctx.body) : undefined
    if (holder === undefined || holder.name === undefined) return
    if (ctx.path === '/sign-in/email-otp' && holder.name === '') return
    const parsed = NameSchema.safeParse(holder.name)
    if (!parsed.success) throw new APIError('BAD_REQUEST', { code: 'INVALID_NAME', message: 'A name is 1 to 80 characters on one line.' })
    holder.name = parsed.data
  }

  const refuseGuests = async (ctx: HookContext): Promise<void> => {
    const session = await getSessionFromCtx(ctx)
    if (!session) return
    const query = isRecord(ctx.query) ? ctx.query : {}
    const slug = typeof query.organizationSlug === 'string' ? query.organizationSlug : undefined
    const bySlug = slug
      ? await ctx.context.adapter.findOne<{ id: string }>({ model: 'organization', where: [{ field: 'slug', value: slug }] })
      : null
    const orgId = bySlug?.id ?? (typeof query.organizationId === 'string' ? query.organizationId : session.session.activeOrganizationId)
    if (typeof orgId !== 'string' || orgId === '') return
    const role = await forOrg(db, orgId).findMemberRole(session.user.id)
    if (role !== null && toOrgRole(role) === 'guest') {
      throw new APIError('FORBIDDEN', { code: 'GUESTS_CANNOT_LIST_MEMBERS', message: 'Guests cannot see the member list.' })
    }
  }

  // Before Better Auth sends (or resends) an invitation mail. Only owners and admins of the company count, so
  // nobody else can use up the quota of an address; Better Auth refuses the others itself.
  const countInvitationMail = async (ctx: HookContext): Promise<void> => {
    const session = await getSessionFromCtx(ctx)
    const body = isRecord(ctx.body) ? ctx.body : {}
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const orgId = typeof body.organizationId === 'string' ? body.organizationId : session?.session.activeOrganizationId
    if (!session || email === '' || typeof orgId !== 'string' || orgId === '') return
    const role = toOrgRole((await forOrg(db, orgId).findMemberRole(session.user.id)) ?? '')
    if (role === null || !can(role, 'invite')) return
    const rules = [
      { key: `inviter:${session.user.id}`, max: INVITATION_MAILS_PER_INVITER },
      { key: `to:${orgId}:${email}`, max: INVITATION_MAILS_PER_RECIPIENT },
    ]
    if (!invitationMails.take(rules)) {
      throw new APIError('TOO_MANY_REQUESTS', { code: 'INVITATION_MAIL_LIMIT', message: 'Too many invitation mails today. Try again tomorrow.' })
    }
  }

  // A removed member cannot come back with an invite link (http/routes.ts), and the links they made stop working.
  const afterMemberLeft = async (ctx: HookContext): Promise<void> => {
    const returned: unknown = ctx.context.returned
    if (!isRecord(returned) || isAPIError(returned)) return
    const left = ctx.path === '/organization/remove-member' ? returned.member : returned
    if (!isRecord(left) || typeof left.userId !== 'string' || typeof left.organizationId !== 'string') return
    const tenant = forOrg(db, left.organizationId)
    const revoked = await tenant.revokeInviteLinksCreatedBy(left.userId)
    if (ctx.path === '/organization/leave') {
      await tenant.audit({ actorId: left.userId, action: 'member.leave', targetType: 'user', targetId: left.userId, data: { revokedLinks: revoked } })
      return
    }
    const actorId = (await getSessionFromCtx(ctx))?.user.id ?? null
    await tenant.recordRemoval(left.userId, actorId)
    await tenant.audit({ actorId, action: 'member.remove', targetType: 'user', targetId: left.userId, data: { revokedLinks: revoked } })
  }

  return betterAuth({
    appName: 'Virtual Office',
    baseURL: env.BETTER_AUTH_URL,
    basePath: API.auth,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.CLIENT_ORIGIN],
    telemetry: { enabled: false },
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    socialProviders: env.google ? { google: { clientId: env.google.clientId, clientSecret: env.google.clientSecret } } : {},
    // Better Auth turns these off when NODE_ENV is test; keep them on so tests see production behaviour.
    rateLimit: { enabled: true, customRules: env.NODE_ENV === 'development' ? { ...RATE_LIMITS, ...DEV_RATE_LIMITS } : RATE_LIMITS },
    advanced: { useSecureCookies: env.isProduction, disableOriginCheck: false },
    // The realtime JWT comes from GET /api/rt-token (one office, its own audience); Better Auth's session JWT is off.
    // Companies are created with their office through POST /api/companies (auth.api.createOrganization).
    disabledPaths: ['/token', '/organization/create'],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        checkName(ctx)
        if (DIRECTORY_PATHS.has(ctx.path)) await refuseGuests(ctx)
        if (ctx.path === '/organization/invite-member') await countInvitationMail(ctx)
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (MEMBERSHIP_CHANGES.has(ctx.path)) invalidateOfficeAccess(db)
        if (ctx.path === '/organization/remove-member' || ctx.path === '/organization/leave') await afterMemberLeft(ctx)
      }),
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: OTP_EXPIRES_IN_S,
        storeOTP: 'hashed',
        async sendVerificationOTP({ email, otp }) {
          await mailer.sendMail({
            to: email,
            subject: `Your Virtual Office sign-in code: ${otp}`,
            text: `Your sign-in code is ${otp}.\nIt is valid for ${OTP_EXPIRES_IN_S / 60} minutes.\n\nIf you did not ask for this code, you can ignore this mail.`,
          })
        },
      }),
      organization({
        ac,
        roles,
        membershipLimit: 500,
        organizationLimit: async (user) =>
          (await forUser(db, user.id).memberships()).filter((m) => toOrgRole(m.role) === 'owner').length >= MAX_OWNED_COMPANIES,
        invitationExpiresIn: INVITATION_EXPIRES_IN_S,
        // Only one exact role per member ('owner', not 'member, owner' or 'owner '), so Better Auth and toOrgRole agree.
        organizationHooks: {
          beforeCreateInvitation: async ({ invitation }) => requireOneRole(invitation.role),
          beforeAddMember: async ({ member }) => requireOneRole(member.role),
          beforeUpdateMemberRole: async ({ newRole }) => requireOneRole(newRole),
          // An email invitation is how an owner or admin lets a removed member back in.
          afterAcceptInvitation: async ({ member, organization: company }) => forOrg(db, company.id).clearRemoval(member.userId),
        },
        async sendInvitationEmail({ id, email, role, organization: company, inviter }) {
          const url = `${env.CLIENT_ORIGIN}${CLIENT_ROUTES.acceptInvitation(id)}`
          const who = plainMailText(inviter.user.name, inviter.user.email)
          const where = plainMailText(company.name, 'a company')
          await mailer.sendMail({
            to: email,
            subject: `${who} invited you to ${where} on Virtual Office`,
            text:
              `${who} invited you to join ${where} as ${role}.\n\n` +
              `Accept the invitation: ${url}\n\n` +
              `Sign in with this email address (${email}). The invitation expires in ${INVITATION_EXPIRES_IN_S / 3600} hours.`,
          })
        },
      }),
      jwt({
        jwks: { keyPairConfig: { alg: 'EdDSA', crv: 'Ed25519' } },
        jwt: { expirationTime: '15m' },
        // Otherwise every get-session (each /api request) would mint a JWT into a response header.
        disableSettingJwtHeader: true,
      }),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>

function requireOneRole(role: string): void {
  if (!isOrgRole(role)) {
    throw new APIError('BAD_REQUEST', { code: 'INVALID_ROLE', message: `The role must be exactly one of: ${ORG_ROLES.join(', ')}.` })
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
