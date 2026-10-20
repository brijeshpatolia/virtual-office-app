import type { ChatHistoryResponse, ChatUnreadResponse, MemberSummary, OrgRole, UpdatePrefsRequest, UserPrefs } from '@vo/shared'
import { fetchChatHistory, fetchChatUnread, fetchMembers, fetchPrefs, updatePrefs } from '../api/endpoints.ts'

// Who is in the office page, from GET /api/me and GET /api/offices/:id.
export interface OfficeSelf {
  userId: string
  name: string
  role: OrgRole
  orgId: string
  officeId: string
}

// The HTTP side of the office (chat history, unread, members, prefs). The mock office implements it in memory.
export interface OfficeApi {
  chatHistory(before?: string): Promise<ChatHistoryResponse>
  chatUnread(): Promise<ChatUnreadResponse>
  // Guests may not list the members (403); call it for the other roles only.
  members(): Promise<MemberSummary[]>
  prefs(): Promise<UserPrefs>
  updatePrefs(patch: UpdatePrefsRequest): Promise<UserPrefs>
}

const prefsOf = ({ statusText, blockedUserIds, notifyMentions }: UserPrefs): UserPrefs => ({ statusText, blockedUserIds, notifyMentions })

export function httpOfficeApi(self: OfficeSelf): OfficeApi {
  return {
    chatHistory: (before) => fetchChatHistory(self.officeId, before),
    chatUnread: () => fetchChatUnread(self.officeId),
    members: async () => (await fetchMembers(self.officeId)).members,
    prefs: async () => prefsOf(await fetchPrefs(self.orgId)),
    updatePrefs: async (patch) => prefsOf(await updatePrefs(self.orgId, patch)),
  }
}
