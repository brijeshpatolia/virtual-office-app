import { z } from 'zod'

// HTTP API of the office server. Every route answers JSON. Errors: ApiError with the status in API_ERRORS.
// Auth: the Better Auth session cookie (httpOnly), sent with credentials: 'include'. Requests other than GET, HEAD
// and OPTIONS to the routes below must carry Origin = CLIENT_ORIGIN (else 403 forbidden).

export const ORG_ROLES = ['owner', 'admin', 'member', 'guest'] as const
export type OrgRole = (typeof ORG_ROLES)[number]
export const OrgRoleSchema = z.enum(ORG_ROLES)

export const INVITE_ROLES = ['member', 'guest'] as const
export type InviteRole = (typeof INVITE_ROLES)[number]

export const TEMPLATE_ID = 'startup-hq-40x30'

export const API = {
  // Better Auth: email OTP, Google, organization (email invitations), /jwks. Its session JWT (/token) is off;
  // the realtime token comes from rtToken.
  auth: '/api/auth',
  config: '/api/config',
  me: '/api/me',
  companies: '/api/companies',
  office: (officeId: string) => `/api/offices/${encodeURIComponent(officeId)}`,
  inviteLinks: (officeId: string) => `/api/offices/${encodeURIComponent(officeId)}/invite-links`,
  inviteLink: (token: string) => `/api/invite-links/${encodeURIComponent(token)}`,
  officeInviteLink: (officeId: string, linkId: string) =>
    `/api/offices/${encodeURIComponent(officeId)}/invite-links/${encodeURIComponent(linkId)}`,
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
  length_required: 411,
  payload_too_large: 413,
  unsupported_media_type: 415,
  rate_limited: 429,
  internal: 500,
} as const
export type ApiErrorCode = keyof typeof API_ERRORS
export const ApiErrorSchema = z.object({
  error: z.enum(Object.keys(API_ERRORS) as [ApiErrorCode, ...ApiErrorCode[]]),
  message: z.string().optional(),
})
export type ApiError = z.infer<typeof ApiErrorSchema>

// Display, company and office names: one line, at most NAME_MAX_LENGTH characters after trimming.
export const NAME_MAX_LENGTH = 80
export const NameSchema = z
  .string()
  .trim()
  .min(1)
  .max(NAME_MAX_LENGTH)
  .regex(/^[^\p{Cc}]*$/u, 'no control characters')
const name = NameSchema
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

// GET /api/config (public): the sign-in options of this server. google: Google sign-in is configured.
export const ClientConfigResponseSchema = z.object({ google: z.boolean() })
export type ClientConfigResponse = z.infer<typeof ClientConfigResponseSchema>

// GET /api/me (signed in): the user, the companies they belong to and the offices of those companies.
export const MeResponseSchema = z.object({
  user: UserSummarySchema,
  orgs: z.array(OrgSummarySchema),
  offices: z.array(OfficeSummarySchema),
})
export type MeResponse = z.infer<typeof MeResponseSchema>

// POST /api/companies (signed in), 201: a Better Auth organization (the caller is its owner) and its office from
// TEMPLATE_ID.
export const CreateCompanyRequestSchema = z.object({ companyName: name, officeName: name })
export type CreateCompanyRequest = z.infer<typeof CreateCompanyRequestSchema>
export const CreateCompanyResponseSchema = z.object({ orgId: z.string(), officeId: z.string() })
export type CreateCompanyResponse = z.infer<typeof CreateCompanyResponseSchema>

// POST /api/offices/:officeId/invite-links (owner or admin), 201. url = CLIENT_ORIGIN + CLIENT_ROUTES.invite(token).
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

// GET /api/offices/:officeId/invite-links (owner or admin): the links that still let someone join, newest first.
export const InviteLinkSummarySchema = z.object({
  id: z.string(),
  role: z.enum(INVITE_ROLES),
  uses: z.number().int(),
  maxUses: z.number().int().nullable(),
  expiresAt: isoDate,
  createdAt: isoDate,
  createdBy: z.string(),
})
export type InviteLinkSummary = z.infer<typeof InviteLinkSummarySchema>
export const ListInviteLinksResponseSchema = z.object({ links: z.array(InviteLinkSummarySchema) })
export type ListInviteLinksResponse = z.infer<typeof ListInviteLinksResponseSchema>

// DELETE /api/offices/:officeId/invite-links/:linkId (owner or admin). 404 when the link is not an open link of
// this office.
export const RevokeInviteLinkResponseSchema = z.object({ id: z.string(), revoked: z.literal(true) })
export type RevokeInviteLinkResponse = z.infer<typeof RevokeInviteLinkResponseSchema>

// GET /api/invite-links/:token (public). 404 for an unknown token; valid=false when expired, revoked or used up.
export const InviteLinkInfoResponseSchema = z.object({
  companyName: z.string(),
  officeName: z.string(),
  role: z.enum(INVITE_ROLES),
  valid: z.boolean(),
})
export type InviteLinkInfoResponse = z.infer<typeof InviteLinkInfoResponseSchema>

// POST /api/invite-links/:token/accept (signed in). 404 for an unknown token, 410 invite_invalid when expired,
// revoked or used up, 403 forbidden (message 'removed') for someone an owner or admin removed from the company: only
// an email invitation lets them back in. A user who is already a member gets 200 and the link keeps its uses.
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
