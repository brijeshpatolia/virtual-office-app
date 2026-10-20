import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { CLIENT_ROUTES, type MeResponse } from '@vo/shared'
import { authClient, unwrap } from '../api/authClient.ts'
import { fetchMe } from '../api/endpoints.ts'
import { errorMessage } from '../api/http.ts'
import { useResource, type Resource } from '../hooks/useResource.ts'
import { navigate, useCurrentUrl } from '../router/navigation.tsx'
import { loginPath } from '../router/routes.ts'
import {
  buttonStyle,
  cardStyle,
  disabled,
  errorStyle,
  inputStyle,
  labelStyle,
  pageStyle,
  textStyle,
  titleStyle,
} from '../ui/pageStyles.ts'

const loadMe = (): Promise<MeResponse | null> => fetchMe()

// The signed-in user (null = signed out). reload() fetches it again.
export function useMe(): [Resource<MeResponse | null>, () => void] {
  const [version, setVersion] = useState(0)
  return [useResource(loadMe, 'me', version), () => setVersion((v) => v + 1)]
}

export function Page({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <main style={pageStyle} data-testid={testId}>
      <div style={cardStyle}>{children}</div>
    </main>
  )
}

export function Message({ title, text, children }: { title: string; text?: string; children?: ReactNode }) {
  return (
    <Page testId="message">
      <h1 style={titleStyle}>{title}</h1>
      {text && <p style={textStyle}>{text}</p>}
      {children}
    </Page>
  )
}

export function ErrorMessage({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Message title="Something went wrong" text={errorMessage(error)}>
      {onRetry && (
        <button type="button" style={buttonStyle} onClick={onRetry}>
          Try again
        </button>
      )}
    </Message>
  )
}

// A form error, read out by screen readers as it appears. Point the field at it with fieldErrorProps(id, error).
export function FormError({ id, error }: { id: string; error: string | null }) {
  if (!error) return null
  return (
    <p id={id} role="alert" style={errorStyle}>
      {error}
    </p>
  )
}

export function fieldErrorProps(id: string, error: string | null) {
  return error ? { 'aria-invalid': true, 'aria-describedby': id } : {}
}

export function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, { replace: true }), [to])
  return null
}

// Renders children only for a signed-in user with a name; sends everyone else to /login and back here.
export function SignedIn({ children }: { children: (me: MeResponse, reload: () => void) => ReactNode }) {
  const [me, reload] = useMe()
  const here = useCurrentUrl()
  if (me.status === 'loading') return <Message title="Loading…" />
  if (me.status === 'error') return <ErrorMessage error={me.error} onRetry={reload} />
  if (me.data === null) return <Redirect to={loginPath(here)} />
  if (me.data.user.name.trim() === '') return <NameForm email={me.data.user.email} onDone={reload} />
  return children(me.data, reload)
}

// New email sign-ups have no name yet; the name tag and the token need one.
function NameForm({ email, onDone }: { email: string; onDone: () => void }) {
  const [name, setName] = useState(() => email.split('@')[0] ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    unwrap(authClient.updateUser({ name: trimmed.slice(0, 80) }))
      .then(onDone, (e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(false))
  }

  return (
    <Page testId="name-form">
      <h1 style={titleStyle}>What should we call you?</h1>
      <p style={textStyle}>Your name shows above your avatar.</p>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={labelStyle}>
          Your name
          <input
            style={inputStyle}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            autoFocus
            required
            data-testid="name-input"
            {...fieldErrorProps('name-error', error)}
          />
        </label>
        <FormError id="name-error" error={error} />
        <button type="submit" style={disabled(buttonStyle, busy)} disabled={busy} data-testid="name-submit">
          Continue
        </button>
      </form>
    </Page>
  )
}

export async function signOut(): Promise<void> {
  await authClient.signOut().catch(() => undefined)
  navigate(CLIENT_ROUTES.login, { replace: true })
}
