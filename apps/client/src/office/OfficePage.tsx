import { useEffect, useMemo, useRef, useState } from 'react'
import type { MeResponse, OfficeResponse } from '@vo/shared'
import { createInviteLink, fetchOffice, listInviteLinks, revokeInviteLink } from '../api/endpoints.ts'
import { isApiError } from '../api/http.ts'
import { useResource } from '../hooks/useResource.ts'
import { joinColyseusOffice } from '../net/colyseusLink.ts'
import type { OfficeLink } from '../net/officeLink.ts'
import { ErrorMessage, Message, SignedIn, signOut } from '../pages/common.tsx'
import { useAccessToken, useOfficeConnection } from './hooks.ts'
import { httpOfficeApi, type OfficeSelf } from './officeApi.ts'
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
  const { office } = details
  const getToken = useAccessToken(office.id)
  const [connection, reconnect] = useOfficeConnection(office.id, getToken, joinColyseusOffice)
  const role = useCurrentRole(office.id, details.role, connection.kind === 'connected' ? connection.link : null)
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
  const self = useMemo<OfficeSelf>(
    () => ({ userId: me.user.id, name: me.user.name, role, orgId: office.orgId, officeId: office.id }),
    [me.user.id, me.user.name, role, office.orgId, office.id],
  )
  // Not on self: a role change must not start the chat over.
  const api = useMemo(() => httpOfficeApi({ officeId: office.id, orgId: office.orgId }), [office.id, office.orgId])

  const leaveAndSignOut = (): void => {
    void signOut()
  }

  return (
    <OfficeView
      companyName={company?.name ?? ''}
      officeName={office.name}
      userName={me.user.name}
      invites={invites}
      self={self}
      api={api}
      onSignOut={leaveAndSignOut}
      connection={connection}
      onReconnect={reconnect}
    />
  )
}

// The user's role, as it is now: from the page load, then from the room (role:changed), and read again with each new
// connection (entering again after a kick or a lost connection), so what the page offers follows a role change.
function useCurrentRole(officeId: string, initial: OfficeResponse['role'], link: OfficeLink | null): OfficeResponse['role'] {
  const [role, setRole] = useState(initial)
  const firstLink = useRef<OfficeLink | null>(null)
  useEffect(() => {
    if (link === null) return
    let live = true
    firstLink.current ??= link
    if (firstLink.current !== link) {
      fetchOffice(officeId).then(
        (fresh) => {
          if (live) setRole(fresh.role)
        },
        () => undefined,
      )
    }
    const stop = link.onRoleChanged(({ role: next }) => setRole(next))
    return () => {
      live = false
      stop()
    }
  }, [officeId, link])
  return role
}
