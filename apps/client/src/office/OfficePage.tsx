import { useMemo } from 'react'
import type { MeResponse, OfficeResponse } from '@vo/shared'
import { createInviteLink, fetchOffice, listInviteLinks, revokeInviteLink } from '../api/endpoints.ts'
import { isApiError } from '../api/http.ts'
import { useResource } from '../hooks/useResource.ts'
import { joinColyseusOffice } from '../net/colyseusLink.ts'
import { ErrorMessage, Message, SignedIn, signOut } from '../pages/common.tsx'
import { useAccessToken, useOfficeConnection } from './hooks.ts'
import type { InviteActions } from './OfficeHeader.tsx'
import { OfficeView } from './OfficeView.tsx'

// Links made in the header: 3 days and 10 people at most (the API allows up to 30 days and 1000 uses).
export const HEADER_INVITE_LINK = { expiresInHours: 72, maxUses: 10 } as const

// /office/:officeId for members of the office's company.
export function OfficePage({ officeId }: { officeId: string }) {
  return <SignedIn>{(me) => <MemberOffice officeId={officeId} me={me} />}</SignedIn>
}

function MemberOffice({ officeId, me }: { officeId: string; me: MeResponse }) {
  const office = useResource(fetchOffice, officeId)
  if (office.status === 'loading') return <Message title="Opening the office…" />
  if (office.status === 'error') {
    if (isApiError(office.error, 'not_found')) {
      return <Message title="Office not found" text="It does not exist, or you are not a member of its company." />
    }
    return <ErrorMessage error={office.error} />
  }
  return <ConnectedOffice details={office.data} me={me} />
}

function ConnectedOffice({ details, me }: { details: OfficeResponse; me: MeResponse }) {
  const { office, role } = details
  const getToken = useAccessToken(office.id)
  const [connection, reconnect] = useOfficeConnection(office.id, getToken, joinColyseusOffice)
  const invites = useMemo<InviteActions | null>(
    () =>
      role === 'owner' || role === 'admin'
        ? {
            create: async (inviteRole) => (await createInviteLink(office.id, { role: inviteRole, ...HEADER_INVITE_LINK })).url,
            list: async () => (await listInviteLinks(office.id)).links,
            revoke: async (linkId) => {
              await revokeInviteLink(office.id, linkId)
            },
          }
        : null,
    [office.id, role],
  )
  const company = me.orgs.find((org) => org.id === office.orgId)

  const leaveAndSignOut = (): void => {
    void signOut()
  }

  return (
    <OfficeView
      companyName={company?.name ?? ''}
      officeName={office.name}
      userName={me.user.name}
      invites={invites}
      onSignOut={leaveAndSignOut}
      connection={connection}
      onReconnect={reconnect}
    />
  )
}
