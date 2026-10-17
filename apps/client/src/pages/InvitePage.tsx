import { useState } from 'react'
import { CLIENT_ROUTES, type InviteLinkInfoResponse } from '@vo/shared'
import { acceptInviteLink, fetchInviteLink } from '../api/endpoints.ts'
import { errorMessage, isApiError } from '../api/http.ts'
import { useResource } from '../hooks/useResource.ts'
import { navigate } from '../router/navigation.tsx'
import { loginPath } from '../router/routes.ts'
import { buttonStyle, disabled, errorStyle, textStyle, titleStyle } from '../ui/pageStyles.ts'
import { ErrorMessage, Message, Page, useMe } from './common.tsx'

// /invite/:token: anyone may see where the link leads; joining needs a sign-in (and comes back here).
export function InvitePage({ token }: { token: string }) {
  const info = useResource(fetchInviteLink, token)
  const [me] = useMe()

  if (info.status === 'loading' || me.status === 'loading') return <Message title="Loading…" />
  if (info.status === 'error') {
    if (isApiError(info.error, 'not_found')) return <Message title="Invite not found" text="Check the link, or ask for a new one." />
    return <ErrorMessage error={info.error} />
  }
  if (!info.data.valid) {
    return <Message title="This invite has expired" text="The link is too old or was used up. Ask for a new one." />
  }
  if (me.status === 'error') return <ErrorMessage error={me.error} />
  return <JoinCard info={info.data} token={token} signedIn={me.data !== null} />
}

function JoinCard({ info, token, signedIn }: { info: InviteLinkInfoResponse; token: string; signedIn: boolean }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const join = (): void => {
    if (!signedIn) return navigate(loginPath(CLIENT_ROUTES.invite(token)))
    setBusy(true)
    setError(null)
    acceptInviteLink(token)
      .then(({ officeId }) => navigate(CLIENT_ROUTES.office(officeId), { replace: true }))
      .catch((e: unknown) => {
        setError(isApiError(e, 'invite_invalid') ? 'This invite is no longer valid. Ask for a new one.' : errorMessage(e))
        setBusy(false)
      })
  }

  return (
    <Page testId="invite-page">
      <h1 style={titleStyle}>Join {info.companyName}</h1>
      <p style={textStyle}>
        You are invited to the office <strong>{info.officeName}</strong>
        {info.role === 'guest' ? ' as a guest (lobby and meeting room only).' : '.'}
      </p>
      {error && <p style={errorStyle}>{error}</p>}
      <button type="button" style={disabled(buttonStyle, busy)} disabled={busy} onClick={join} data-testid="invite-join">
        {signedIn ? `Join ${info.companyName}` : 'Sign in to join'}
      </button>
    </Page>
  )
}
