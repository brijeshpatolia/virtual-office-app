import { useCallback } from 'react'
import type { JoinOffice } from '../net/officeLink.ts'
import { useOfficeConnection } from './hooks.ts'
import { OfficeView } from './OfficeView.tsx'

// DEV ONLY (/dev/office): the office against an in-browser mock server, for checking the rendering without
// accounts or a running server. App.tsx loads this module only in dev builds.
const joinMock: JoinOffice = async (officeId, token) => {
  const { joinMockOffice } = await import('../net/mockOffice.ts')
  return joinMockOffice(officeId, token)
}

const mockToken = async (): Promise<string> => 'mock-token'

export default function DevOfficePage() {
  const [connection, reconnect] = useOfficeConnection('mock-office', mockToken, joinMock)
  const createInvite = useCallback(async () => `${window.location.origin}/invite/mock-invite-token`, [])
  return (
    <OfficeView
      companyName="Mock Company"
      officeName="Dev office (mock server)"
      userName="You (mock)"
      createInvite={createInvite}
      onSignOut={() => window.location.assign('/')}
      connection={connection}
      onReconnect={reconnect}
    />
  )
}
