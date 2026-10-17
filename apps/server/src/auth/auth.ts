import { schema, type Db } from '@vo/db'
import { API, CLIENT_ROUTES } from '@vo/shared'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { createAuthMiddleware } from 'better-auth/api'
import { emailOTP, jwt, organization } from 'better-auth/plugins'
import type { Env } from '../env.ts'
import type { Mailer } from '../mail/mailer.ts'
import { ac, roles } from './access.ts'
import { invalidateOfficeAccess } from './membership.ts'

export interface AuthDeps {
  env: Env
  db: Db
  mailer: Mailer
}

export const OTP_EXPIRES_IN_S = 5 * 60
export const INVITATION_EXPIRES_IN_S = 48 * 3600

// Better Auth endpoints after which a cached office access may be wrong.
const MEMBERSHIP_CHANGES = new Set([
  '/organization/remove-member',
  '/organization/leave',
  '/organization/update-member-role',
  '/organization/delete',
  '/delete-user',
])

// Behind the Vite dev proxy no request carries a client IP, so every user shares one rate-limit bucket. Allow more
// than Better Auth's 3 codes per minute and 3 sign-ins per 10 s there (several test users, e2e runs).
const DEV_RATE_LIMITS = {
  '/email-otp/send-verification-otp': { window: 60, max: 30 },
  '/sign-in/*': { window: 10, max: 30 },
}

// The Better Auth instance: email OTP (no passwords), Google when configured, companies as organizations with the
// roles owner, admin, member and guest, email invitations, and the EdDSA keys that sign the realtime token
// (GET /api/rt-token in http/routes.ts).
export function createAuth({ env, db, mailer }: AuthDeps) {
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
    rateLimit: { enabled: true, customRules: env.NODE_ENV === 'development' ? DEV_RATE_LIMITS : undefined },
    advanced: { useSecureCookies: env.isProduction, disableOriginCheck: false },
    // The realtime JWT comes from GET /api/rt-token (one office, its own audience); Better Auth's session JWT is off.
    disabledPaths: ['/token'],
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        if (MEMBERSHIP_CHANGES.has(ctx.path)) invalidateOfficeAccess(db)
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
        invitationExpiresIn: INVITATION_EXPIRES_IN_S,
        async sendInvitationEmail({ id, email, role, organization: company, inviter }) {
          const url = `${env.CLIENT_ORIGIN}${CLIENT_ROUTES.acceptInvitation(id)}`
          const who = inviter.user.name || inviter.user.email
          await mailer.sendMail({
            to: email,
            subject: `${who} invited you to ${company.name} on Virtual Office`,
            text:
              `${who} invited you to join ${company.name} as ${role}.\n\n` +
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
