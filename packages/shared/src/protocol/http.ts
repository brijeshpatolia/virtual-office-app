import { z } from 'zod'

// HTTP API of the office server. Every route answers JSON. Errors: ApiError with the status in API_ERRORS.
// Auth: the Better Auth session cookie (httpOnly), sent with credentials: 'include'.

export const ORG_ROLES = ['owner', 'admin', 'member', 'guest'] as const
export type OrgRole = (typeof ORG_ROLES)[number]
export const OrgRoleSchema = z.enum(ORG_ROLES)

export const INVITE_ROLES = ['member', 'guest'] as const
export type InviteRole = (typeof INVITE_ROLES)[number]

export const TEMPLATE_ID = 'startup-hq-40x30'

export const API = {
  // Better Auth: email OTP, Google, organization (email invitations), /token, /jwks.
  auth: '/api/auth',
  me: '/api/me',
  companies: '/api/companies',
  office: (officeId: string) => `/api/offices/${encodeURIComponent(officeId)}`,
  inviteLinks: (officeId: string) => `/api/offices/${encodeURIComponent(officeId)}/invite-links`,
  inviteLink: (token: string) => `/api/invite-links/${encodeURIComponent(token)}`,
  acceptInviteLink: (token: string) => `/api/invite-links/${encodeURIComponent(token)}/accept`,
  rtToken: (officeId: string) => `/api/rt-token?officeId=${encodeURIComponent(officeId)}`,
} as const

// Client pages that the server links to (invite links, invitation emails).
export const CLIENT_ROUTES = {
  login: '/login',
  onboarding: '/onboarding',
  office: (officeId: string) => `/office/${encodeURIComponent(officeId)}`,
  invite: (token: string) => `/invite/${encodeURIComponent(token)}`,
  acceptInvitation: (invitationId: string) => `/accept-invitation/${encodeURIComponent(invitationId)}`,
} as const

export const API_ERRORS = {
  invalid_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  invite_invalid: 410,
  rate_limited: 429,
  internal: 500,
} as const
export type ApiErrorCode = keyof typeof API_ERRORS
export const ApiErrorSchema = z.object({
  error: z.enum(Object.keys(API_ERRORS) as [ApiErrorCode, ...ApiErrorCode[]]),
  message: z.string().optional(),
})
export type ApiError = z.infer<typeof ApiErrorSchema>

const name = z.string().trim().min(1).max(80)
const isoDate = z.iso.datetime()

export const UserSummarySchema = z.object({
  id: z.string(),
  // May be '' for a new email-OTP user; show the email then.
  name: z.string(),
  email: z.string(),
  image: z.string().nullable(),
})
export const OrgSummarySchema = z.object({ id: z.string(), name: z.string(), slug: z.string(), role: OrgRoleSchema })
export const OfficeSummarySchema = z.object({ id: z.string(), orgId: z.string(), name: z.string() })

// GET /api/me (signed in): the user, the companies they belong to and the offices of those companies.
export const MeResponseSchema = z.object({
  user: UserSummarySchema,
  orgs: z.array(OrgSummarySchema),
  offices: z.array(OfficeSummarySchema),
})
export type MeResponse = z.infer<typeof MeResponseSchema>

// POST /api/companies (signed in): a Better Auth organization (the caller is its owner) and its office from
// TEMPLATE_ID.
export const CreateCompanyRequestSchema = z.object({ companyName: name, officeName: name })
export type CreateCompanyRequest = z.infer<typeof CreateCompanyRequestSchema>
export const CreateCompanyResponseSchema = z.object({ orgId: z.string(), officeId: z.string() })
export type CreateCompanyResponse = z.infer<typeof CreateCompanyResponseSchema>

// POST /api/offices/:officeId/invite-links (owner or admin). url = CLIENT_ORIGIN + CLIENT_ROUTES.invite(token).
// The token is shown once; the server stores only its hash.
export const CreateInviteLinkRequestSchema = z.object({
  role: z.enum(INVITE_ROLES),
  maxUses: z.number().int().min(1).max(1000).optional(),
  // Default 168 (7 days).
  expiresInHours: z.number().int().min(1).max(720).optional(),
})
export type CreateInviteLinkRequest = z.infer<typeof CreateInviteLinkRequestSchema>
export const CreateInviteLinkResponseSchema = z.object({ url: z.string(), token: z.string(), expiresAt: isoDate })
export type CreateInviteLinkResponse = z.infer<typeof CreateInviteLinkResponseSchema>

// GET /api/invite-links/:token (public). 404 for an unknown token; valid=false when expired, revoked or used up.
export const InviteLinkInfoResponseSchema = z.object({
  companyName: z.string(),
  officeName: z.string(),
  role: z.enum(INVITE_ROLES),
  valid: z.boolean(),
})
export type InviteLinkInfoResponse = z.infer<typeof InviteLinkInfoResponseSchema>

// POST /api/invite-links/:token/accept (signed in). 410 invite_invalid when not valid.
// A user who is already a member gets 200 and the link keeps its uses.
export const AcceptInviteLinkResponseSchema = z.object({ orgId: z.string(), officeId: z.string() })
export type AcceptInviteLinkResponse = z.infer<typeof AcceptInviteLinkResponseSchema>

// GET /api/offices/:officeId (members only; 404 for everyone else, so office ids do not leak).
export const OfficeDetailsSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  name: z.string(),
  templateId: z.string(),
  templateVersion: z.number().int(),
})
export const OfficeResponseSchema = z.object({ office: OfficeDetailsSchema, role: OrgRoleSchema })
export type OfficeResponse = z.infer<typeof OfficeResponseSchema>

// GET /api/rt-token?officeId= (members only). The JWT that the office room checks in onAuth.
// EdDSA, 15 min, claims {sub: userId, orgId, officeId, role, name}. Keep it in memory only.
export const RtTokenQuerySchema = z.object({ officeId: z.string().min(1).max(64) })
export const RtTokenResponseSchema = z.object({ token: z.string(), expiresAt: isoDate })
export type RtTokenResponse = z.infer<typeof RtTokenResponseSchema>
