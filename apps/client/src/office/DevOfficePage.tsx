import type { InviteLinkSummary } from '@vo/shared'
import type { JoinOffice } from '../net/officeLink.ts'
import { useOfficeConnection } from './hooks.ts'
import type { InviteActions } from './OfficeHeader.tsx'
import { OfficeView } from './OfficeView.tsx'

// DEV ONLY (/dev/office): the office against an in-browser mock server, for checking the rendering without
// accounts or a running server. App.tsx loads this module only in dev builds.
const joinMock: JoinOffice = async (officeId, token) => {
  const { joinMockOffice } = await import('../net/mockOffice.ts')
  return joinMockOffice(officeId, token)
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
  return (
    <OfficeView
      companyName="Mock Company"
      officeName="Dev office (mock server)"
      userName="You (mock)"
      invites={mockInvites}
      onSignOut={() => window.location.assign('/')}
      connection={connection}
      onReconnect={reconnect}
    />
  )
}
