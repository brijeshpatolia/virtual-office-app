import { CLIENT_ROUTES } from '@vo/shared'
import { Redirect, SignedIn } from './common.tsx'

// '/': signed out -> /login (SignedIn), no company yet -> /onboarding, else the first office.
export function HomePage() {
  return (
    <SignedIn>
      {(me) => {
        const office = me.offices[0]
        return <Redirect to={office ? CLIENT_ROUTES.office(office.id) : CLIENT_ROUTES.onboarding} />
      }}
    </SignedIn>
  )
}
