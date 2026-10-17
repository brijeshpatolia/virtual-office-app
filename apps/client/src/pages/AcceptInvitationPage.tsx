import { useState } from 'react'
import { CLIENT_ROUTES, type MeResponse } from '@vo/shared'
import { authClient, unwrap } from '../api/authClient.ts'
import { fetchMe } from '../api/endpoints.ts'
import { errorMessage } from '../api/http.ts'
import { useResource } from '../hooks/useResource.ts'
import { navigate } from '../router/navigation.tsx'
import { buttonStyle, disabled, errorStyle, textStyle, titleStyle } from '../ui/pageStyles.ts'
import { Message, Page, SignedIn } from './common.tsx'

async function loadInvitation(id: string) {
  const invitation = await unwrap(authClient.organization.getInvitation({ query: { id } }))
  if (!invitation) throw new Error('This invitation does not exist.')
  return invitation
}

// /accept-invitation/:invitationId: the link in an invitation email (Better Auth organization invitations).
// The invitee must be signed in with the invited email address.
export function AcceptInvitationPage({ invitationId }: { invitationId: string }) {
  return <SignedIn>{(me) => <Invitation invitationId={invitationId} me={me} />}</SignedIn>
}

function Invitation({ invitationId, me }: { invitationId: string; me: MeResponse }) {
  const invitation = useResource(loadInvitation, invitationId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (invitation.status === 'loading') return <Message title="Loading…" />
  if (invitation.status === 'error') {
    return (
      <Message
        title="Invitation not available"
        text={`${errorMessage(invitation.error)} You are signed in as ${me.user.email}; the invitation must be for this address.`}
      />
    )
  }
  const { organizationName, organizationId, role } = invitation.data

  const accept = (): void => {
    setBusy(true)
    setError(null)
    unwrap(authClient.organization.acceptInvitation({ invitationId }))
      .then(() => fetchMe())
      .then((fresh) => {
        const office = fresh?.offices.find((o) => o.orgId === organizationId)
        navigate(office ? CLIENT_ROUTES.office(office.id) : '/', { replace: true })
      })
      .catch((e: unknown) => {
        setError(errorMessage(e))
        setBusy(false)
      })
  }

  return (
    <Page testId="accept-invitation-page">
      <h1 style={titleStyle}>Join {organizationName}</h1>
      <p style={textStyle}>
        You are invited as <strong>{role}</strong>.
      </p>
      {error && <p style={errorStyle}>{error}</p>}
      <button type="button" style={disabled(buttonStyle, busy)} disabled={busy} onClick={accept} data-testid="invitation-accept">
        Accept invitation
      </button>
    </Page>
  )
}
