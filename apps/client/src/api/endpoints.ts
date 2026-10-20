import {
  AcceptInviteLinkResponseSchema,
  API,
  ChatHistoryResponseSchema,
  ChatUnreadResponseSchema,
  ClientConfigResponseSchema,
  CreateCompanyResponseSchema,
  CreateInviteLinkResponseSchema,
  InviteLinkInfoResponseSchema,
  ListInviteLinksResponseSchema,
  MembersResponseSchema,
  MeResponseSchema,
  OfficeResponseSchema,
  RevokeInviteLinkResponseSchema,
  RtTokenResponseSchema,
  UserPrefsResponseSchema,
  type AcceptInviteLinkResponse,
  type ChatHistoryResponse,
  type ChatUnreadResponse,
  type ClientConfigResponse,
  type CreateCompanyRequest,
  type CreateCompanyResponse,
  type CreateInviteLinkRequest,
  type CreateInviteLinkResponse,
  type InviteLinkInfoResponse,
  type ListInviteLinksResponse,
  type MembersResponse,
  type MeResponse,
  type OfficeResponse,
  type RevokeInviteLinkResponse,
  type RtTokenResponse,
  type UpdatePrefsRequest,
  type UserPrefsResponse,
} from '@vo/shared'
import { apiRequest, isApiError } from './http.ts'

// null = not signed in.
export async function fetchMe(): Promise<MeResponse | null> {
  try {
    return await apiRequest(API.me, MeResponseSchema)
  } catch (error) {
    if (isApiError(error, 'unauthorized')) return null
    throw error
  }
}

export const createCompany = (body: CreateCompanyRequest): Promise<CreateCompanyResponse> =>
  apiRequest(API.companies, CreateCompanyResponseSchema, { body })

export const fetchOffice = (officeId: string): Promise<OfficeResponse> => apiRequest(API.office(officeId), OfficeResponseSchema)

export const createInviteLink = (officeId: string, body: CreateInviteLinkRequest): Promise<CreateInviteLinkResponse> =>
  apiRequest(API.inviteLinks(officeId), CreateInviteLinkResponseSchema, { body })

export const listInviteLinks = (officeId: string): Promise<ListInviteLinksResponse> =>
  apiRequest(API.inviteLinks(officeId), ListInviteLinksResponseSchema)

export const revokeInviteLink = (officeId: string, linkId: string): Promise<RevokeInviteLinkResponse> =>
  apiRequest(API.officeInviteLink(officeId, linkId), RevokeInviteLinkResponseSchema, { method: 'DELETE' })

export const fetchInviteLink = (token: string): Promise<InviteLinkInfoResponse> =>
  apiRequest(API.inviteLink(token), InviteLinkInfoResponseSchema)

export const acceptInviteLink = (token: string): Promise<AcceptInviteLinkResponse> =>
  apiRequest(API.acceptInviteLink(token), AcceptInviteLinkResponseSchema, { method: 'POST' })

export const fetchRtToken = (officeId: string): Promise<RtTokenResponse> => apiRequest(API.rtToken(officeId), RtTokenResponseSchema)

export const fetchChatHistory = (officeId: string, before?: string): Promise<ChatHistoryResponse> =>
  apiRequest(API.chat(officeId, before === undefined ? {} : { before }), ChatHistoryResponseSchema)

export const fetchChatUnread = (officeId: string): Promise<ChatUnreadResponse> =>
  apiRequest(API.chatUnread(officeId), ChatUnreadResponseSchema)

// 403 forbidden for guests.
export const fetchMembers = (officeId: string): Promise<MembersResponse> => apiRequest(API.members(officeId), MembersResponseSchema)

export const fetchPrefs = (orgId: string): Promise<UserPrefsResponse> => apiRequest(API.prefs(orgId), UserPrefsResponseSchema)

export const updatePrefs = (orgId: string, body: UpdatePrefsRequest): Promise<UserPrefsResponse> =>
  apiRequest(API.prefs(orgId), UserPrefsResponseSchema, { method: 'PUT', body })

// Sign-in options. Any failure hides the Google button.
export async function fetchSignInConfig(): Promise<ClientConfigResponse> {
  try {
    return await apiRequest(API.config, ClientConfigResponseSchema)
  } catch {
    return { google: false }
  }
}
