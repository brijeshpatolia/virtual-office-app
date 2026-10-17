import { useState, type FormEvent } from 'react'
import { CLIENT_ROUTES, type MeResponse } from '@vo/shared'
import { createCompany } from '../api/endpoints.ts'
import { errorMessage } from '../api/http.ts'
import { Link, navigate } from '../router/navigation.tsx'
import { buttonStyle, disabled, errorStyle, inputStyle, labelStyle, textStyle, titleStyle } from '../ui/pageStyles.ts'
import { Page, SignedIn } from './common.tsx'

export function OnboardingPage() {
  return <SignedIn>{(me) => <CreateCompanyForm me={me} />}</SignedIn>
}

// A company (Better Auth organization, you are its owner) and its first office from the startup template.
function CreateCompanyForm({ me }: { me: MeResponse }) {
  const [companyName, setCompanyName] = useState('')
  const [officeName, setOfficeName] = useState('HQ')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const firstOffice = me.offices[0]

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    createCompany({ companyName: companyName.trim(), officeName: officeName.trim() })
      .then(({ officeId }) => navigate(CLIENT_ROUTES.office(officeId), { replace: true }))
      .catch((e: unknown) => {
        setError(errorMessage(e))
        setBusy(false)
      })
  }

  return (
    <Page testId="onboarding-page">
      <h1 style={titleStyle}>Create your company</h1>
      <p style={textStyle}>You get an office for your team. Invite people once you are in.</p>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={labelStyle}>
          Company name
          <input
            style={inputStyle}
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            maxLength={80}
            required
            autoFocus
            data-testid="company-name"
          />
        </label>
        <label style={labelStyle}>
          Office name
          <input
            style={inputStyle}
            value={officeName}
            onChange={(e) => setOfficeName(e.target.value)}
            maxLength={80}
            required
            data-testid="office-name"
          />
        </label>
        {error && <p style={errorStyle}>{error}</p>}
        <button
          type="submit"
          style={disabled(buttonStyle, busy)}
          disabled={busy || !companyName.trim() || !officeName.trim()}
          data-testid="create-company"
        >
          Create office
        </button>
      </form>
      {firstOffice && (
        <p style={textStyle}>
          Or go back to <Link to={CLIENT_ROUTES.office(firstOffice.id)}>{firstOffice.name}</Link>.
        </p>
      )}
    </Page>
  )
}
