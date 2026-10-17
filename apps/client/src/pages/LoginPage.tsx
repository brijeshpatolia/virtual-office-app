import { useEffect, useState, type FormEvent } from 'react'
import { authClient, authErrorText, unwrap } from '../api/authClient.ts'
import { fetchSignInConfig } from '../api/endpoints.ts'
import { errorMessage } from '../api/http.ts'
import { navigate } from '../router/navigation.tsx'
import {
  buttonStyle,
  disabled,
  errorStyle,
  inputStyle,
  labelStyle,
  linkButtonStyle,
  secondaryButtonStyle,
  textStyle,
  titleStyle,
} from '../ui/pageStyles.ts'
import { Page, Redirect, useMe } from './common.tsx'

const formStyle = { display: 'flex', flexDirection: 'column', gap: 12 } as const
const OTP_LENGTH = 6

// Email -> 6-digit code. New emails get an account on the first sign-in. Google only when the server has it.
export function LoginPage({ next }: { next: string }) {
  const [email, setEmail] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [google, setGoogle] = useState(false)
  const [me] = useMe()

  useEffect(() => {
    let live = true
    fetchSignInConfig().then((config) => {
      if (live) setGoogle(config.google)
    })
    return () => {
      live = false
    }
  }, [])

  const run = (action: () => Promise<void>): void => {
    setBusy(true)
    setError(null)
    action()
      .catch((e: unknown) => setError(authErrorText(e) ?? errorMessage(e)))
      .finally(() => setBusy(false))
  }

  const sendCode = (event?: FormEvent): void => {
    event?.preventDefault()
    const address = email.trim().toLowerCase()
    if (!address) return
    run(async () => {
      await unwrap(authClient.emailOtp.sendVerificationOtp({ email: address, type: 'sign-in' }))
      setSentTo(address)
      setCode('')
    })
  }

  const verify = (event: FormEvent): void => {
    event.preventDefault()
    if (!sentTo || code.length !== OTP_LENGTH) return
    run(async () => {
      await unwrap(authClient.signIn.emailOtp({ email: sentTo, otp: code }))
      navigate(next, { replace: true })
    })
  }

  const signInWithGoogle = (): void => {
    run(async () => {
      await unwrap(authClient.signIn.social({ provider: 'google', callbackURL: `${window.location.origin}${next}` }))
    })
  }

  // Already signed in (e.g. the back button): go on.
  if (me.status === 'ready' && me.data !== null) return <Redirect to={next} />

  return (
    <Page testId="login-page">
      <h1 style={titleStyle}>Sign in to Virtual Office</h1>
      {sentTo === null ? (
        <form onSubmit={sendCode} style={formStyle}>
          <p style={textStyle}>We email you a 6-digit code. No password needed.</p>
          <label style={labelStyle}>
            Work email
            <input
              type="email"
              autoComplete="email"
              style={inputStyle}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              data-testid="login-email"
            />
          </label>
          {error && <p style={errorStyle}>{error}</p>}
          <button type="submit" style={disabled(buttonStyle, busy)} disabled={busy} data-testid="login-send-code">
            Email me a code
          </button>
          {google && (
            <button type="button" style={disabled(secondaryButtonStyle, busy)} disabled={busy} onClick={signInWithGoogle}>
              Continue with Google
            </button>
          )}
        </form>
      ) : (
        <form onSubmit={verify} style={formStyle}>
          <p style={textStyle}>
            We sent a code to <strong>{sentTo}</strong>. It is valid for 5 minutes.
          </p>
          {import.meta.env.DEV && (
            <p style={textStyle}>Development: the code is in the server console and in .data/dev-mail.log.</p>
          )}
          <label style={labelStyle}>
            Code
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={OTP_LENGTH}
              style={{ ...inputStyle, letterSpacing: 6, fontSize: 22 }}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, OTP_LENGTH))}
              required
              autoFocus
              data-testid="login-code"
            />
          </label>
          {error && <p style={errorStyle}>{error}</p>}
          <button
            type="submit"
            style={disabled(buttonStyle, busy || code.length !== OTP_LENGTH)}
            disabled={busy || code.length !== OTP_LENGTH}
            data-testid="login-verify"
          >
            Sign in
          </button>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button type="button" style={linkButtonStyle} onClick={() => sendCode()} disabled={busy}>
              Send a new code
            </button>
            <button type="button" style={linkButtonStyle} onClick={() => setSentTo(null)} disabled={busy}>
              Use another email
            </button>
          </div>
        </form>
      )}
    </Page>
  )
}
