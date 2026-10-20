import { useMemo } from 'react'
import { ORG_ROLES, type InviteLinkSummary, type OrgRole } from '@vo/shared'
import type { JoinOffice } from '../net/officeLink.ts'
import { useOfficeConnection } from './hooks.ts'
import type { OfficeApi, OfficeSelf } from './officeApi.ts'
import type { InviteActions } from './OfficeHeader.tsx'
import { OfficeView } from './OfficeView.tsx'

// DEV ONLY (/dev/office): the office against an in-browser mock server, for checking the rendering without
// accounts or a running server. App.tsx loads this module only in dev builds. ?role=guest (or member, admin)
// shows the office as that role; the default is owner.
const mock = async () => {
  const { mockOffice } = await import('../net/mockOffice.ts')
  return mockOffice(MOCK_ROLE)
}

const roleParam = new URLSearchParams(window.location.search).get('role')
const MOCK_ROLE: OrgRole = ORG_ROLES.find((role) => role === roleParam) ?? 'owner'

const joinMock: JoinOffice = async (officeId, token) => (await mock()).join(officeId, token)

const mockApi: OfficeApi = {
  chatHistory: async (before) => (await mock()).api.chatHistory(before),
  chatUnread: async () => (await mock()).api.chatUnread(),
  members: async () => (await mock()).api.members(),
  prefs: async () => (await mock()).api.prefs(),
  updatePrefs: async (patch) => (await mock()).api.updatePrefs(patch),
}

const mockToken = async (): Promise<string> => 'mock-token'

// Invite links kept in memory.
let mockLinks: InviteLinkSummary[] = []
const mockInvites: InviteActions = {
  create: async (role) => {
    const at = Date.now()
    mockLinks = [
      { id: `mock-${at}`, role, uses: 0, maxUses: 10, expiresAt: new Date(at + 72 * 3_600_000).toISOString(), createdAt: new Date(at).toISOString(), createdBy: 'You (mock)' },
      ...mockLinks,
    ]
    return `${window.location.origin}/invite/mock-invite-token`
  },
  list: async () => mockLinks,
  revoke: async (linkId) => {
    mockLinks = mockLinks.filter((link) => link.id !== linkId)
  },
}

export default function DevOfficePage() {
  const [connection, reconnect] = useOfficeConnection('mock-office', mockToken, joinMock)
  const self = useMemo<OfficeSelf>(
    () => ({ userId: 'mock-user-own', name: 'You (mock)', role: MOCK_ROLE, orgId: 'mock-org', officeId: 'mock-office' }),
    [],
  )
  return (
    <OfficeView
      companyName="Mock Company"
      officeName="Dev office (mock server)"
      userName="You (mock)"
      invites={MOCK_ROLE === 'owner' || MOCK_ROLE === 'admin' ? mockInvites : null}
      self={self}
      api={mockApi}
      onSignOut={() => window.location.assign('/')}
      connection={connection}
      onReconnect={reconnect}
    />
  )
}
