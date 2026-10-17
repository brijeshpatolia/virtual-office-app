import { useCallback } from 'react'
import type { InviteRole, MeResponse, OfficeResponse } from '@vo/shared'
import { createInviteLink, fetchOffice } from '../api/endpoints.ts'
import { isApiError } from '../api/http.ts'
import { useResource } from '../hooks/useResource.ts'
import { joinColyseusOffice } from '../net/colyseusLink.ts'
import { ErrorMessage, Message, SignedIn, signOut } from '../pages/common.tsx'
import { useAccessToken, useOfficeConnection } from './hooks.ts'
import { OfficeView } from './OfficeView.tsx'

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
  const createInvite = useCallback(
    (inviteRole: InviteRole) => createInviteLink(office.id, { role: inviteRole }).then((invite) => invite.url),
    [office.id],
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
      createInvite={role === 'owner' || role === 'admin' ? createInvite : null}
      onSignOut={leaveAndSignOut}
      connection={connection}
      onReconnect={reconnect}
    />
  )
}
