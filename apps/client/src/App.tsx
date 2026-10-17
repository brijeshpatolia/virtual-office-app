import { lazy, Suspense, type ReactNode } from 'react'
import { AcceptInvitationPage } from './pages/AcceptInvitationPage.tsx'
import { Message } from './pages/common.tsx'
import { HomePage } from './pages/HomePage.tsx'
import { InvitePage } from './pages/InvitePage.tsx'
import { LoginPage } from './pages/LoginPage.tsx'
import { OnboardingPage } from './pages/OnboardingPage.tsx'
import { Link, useRoute } from './router/navigation.tsx'

// The office (Phaser, Colyseus) loads on demand, so the sign-in pages stay small.
const OfficePage = lazy(() => import('./office/OfficePage.tsx').then((m) => ({ default: m.OfficePage })))
// Only dev builds contain the mock office (production drops this branch and the module).
const DevOfficePage = import.meta.env.DEV ? lazy(() => import('./office/DevOfficePage.tsx')) : null

const loading = (page: ReactNode) => <Suspense fallback={<Message title="Loading…" />}>{page}</Suspense>

export function App() {
  const route = useRoute()
  switch (route.name) {
    case 'home':
      return <HomePage />
    case 'login':
      return <LoginPage next={route.next} />
    case 'onboarding':
      return <OnboardingPage />
    case 'office':
      // A new key per office, so switching offices starts from a fresh page.
      return loading(<OfficePage key={route.officeId} officeId={route.officeId} />)
    case 'invite':
      return <InvitePage key={route.token} token={route.token} />
    case 'acceptInvitation':
      return <AcceptInvitationPage key={route.invitationId} invitationId={route.invitationId} />
    case 'devOffice':
      return DevOfficePage ? loading(<DevOfficePage />) : null
    case 'notFound':
      return (
        <Message title="Page not found">
          <Link to="/">Go to my office</Link>
        </Message>
      )
  }
}
