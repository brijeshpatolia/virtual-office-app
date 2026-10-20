import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { ChatBar } from '../chat/ChatBar.tsx'
import { PhaserGame } from '../game/PhaserGame.tsx'
import type { OfficeScene } from '../game/scenes/OfficeScene.ts'
import { Redirect } from '../pages/common.tsx'
import { PeoplePanel } from '../presence/PeoplePanel.tsx'
import { ProfileCard } from '../presence/ProfileCard.tsx'
import { StatusMenu } from '../presence/StatusMenu.tsx'
import { useMediaQuery } from '../hooks/useMediaQuery.ts'
import { Link, useCurrentUrl } from '../router/navigation.tsx'
import { loginPath } from '../router/routes.ts'
import { Hud } from '../ui/Hud.tsx'
import { pillStyle } from '../ui/hudStyles.ts'
import { buttonStyle, cardStyle, textStyle, titleStyle } from '../ui/pageStyles.ts'
import { headerButtonStyle } from './headerStyles.ts'
import type { OfficeApi, OfficeSelf } from './officeApi.ts'
import { HEADER_HEIGHT, OfficeHeader, type OfficeHeaderProps } from './OfficeHeader.tsx'
import type { ClosedReason, ConnectionState } from './officeConnection.ts'
import { SocialProvider, useOfficeSocial } from './social.tsx'

const rootStyle: CSSProperties = { position: 'relative', display: 'flex', flexDirection: 'column', width: '100%', height: '100%', overflow: 'hidden' }
const stageStyle: CSSProperties = { position: 'relative', flex: '1 1 auto', minHeight: 0, overflow: 'hidden' }
const bannerStyle: CSSProperties = {
  ...pillStyle,
  position: 'absolute',
  top: 12,
  right: 12,
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
}
// Over the map and the chat; the header (sign out) stays usable.
const overlayStyle: CSSProperties = {
  position: 'absolute',
  inset: `${HEADER_HEIGHT}px 0 0 0`,
  zIndex: 30,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
  background: 'rgba(20, 24, 32, 0.45)',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
}

export interface OfficeViewProps extends OfficeHeaderProps {
  self: OfficeSelf
  api: OfficeApi
  connection: ConnectionState
  onReconnect: () => void
}

// The office page: header, the map with the avatars, the HUD, the chat bar under the map and the connection state.
export function OfficeView({ connection, onReconnect, self, api, ...header }: OfficeViewProps) {
  const [scene, setScene] = useState<OfficeScene | null>(null)
  const [peopleOpen, setPeopleOpen] = useState(false)
  const peopleButton = useRef<HTMLButtonElement>(null)
  const narrow = useMediaQuery('(max-width: 640px)')
  const link = connection.kind === 'connected' ? connection.link : null
  const reconnecting = connection.kind === 'connected' && connection.reconnecting
  const social = useOfficeSocial(api, self, link)

  useEffect(() => {
    if (!scene || !link) return
    scene.attach(link)
    return () => scene.detach()
  }, [scene, link])

  useEffect(() => {
    if (scene && link) scene.setReconnecting(reconnecting)
  }, [scene, link, reconnecting])

  const closePeople = (): void => {
    setPeopleOpen(false)
    peopleButton.current?.focus()
  }

  const presence = (
    <>
      <StatusMenu narrow={narrow} />
      <button
        ref={peopleButton}
        type="button"
        style={headerButtonStyle}
        onClick={() => (peopleOpen ? closePeople() : setPeopleOpen(true))}
        aria-expanded={peopleOpen}
        aria-controls="people-panel"
        data-testid="people-toggle"
      >
        People
      </button>
    </>
  )

  return (
    <SocialProvider value={social}>
      <div style={rootStyle}>
        <OfficeHeader {...header} presence={presence} />
        <div style={stageStyle}>
          <PhaserGame onReady={setScene} />
          <Hud />
          <ProfileCard />
          <ConnectionBanner state={connection} />
        </div>
        <ChatBar reconnecting={reconnecting} />
        {peopleOpen && <PeoplePanel onClose={closePeople} />}
        {connection.kind === 'closed' && <Closed reason={connection.reason} detail={connection.detail} onReconnect={onReconnect} />}
      </div>
    </SocialProvider>
  )
}

function ConnectionBanner({ state }: { state: ConnectionState }) {
  if (state.kind === 'connecting') {
    return (
      <div style={bannerStyle} role="status" data-testid="connection-status">
        Connecting to the office…
      </div>
    )
  }
  if (state.kind === 'connected' && state.reconnecting) {
    return (
      <div style={bannerStyle} role="status" data-testid="connection-status">
        Connection lost. Reconnecting…
      </div>
    )
  }
  return null
}

function Closed({ reason, detail, onReconnect }: { reason: ClosedReason; detail: string; onReconnect: () => void }) {
  if (reason === 'signed_out') return <SignInAgain />
  return <ClosedCard reason={reason} detail={detail} onReconnect={onReconnect} />
}

// The session ended (signed out in another tab, or expired): sign in again and come back here.
function SignInAgain() {
  return <Redirect to={loginPath(useCurrentUrl())} />
}

const CLOSED_TEXT = {
  replaced: { title: 'Open in another tab', text: 'You opened this office in another tab or window.', action: 'Use this tab' },
  removed: { title: 'No access', text: 'You no longer have access to this office.', action: null },
  role_changed: { title: 'Your role changed', text: 'Your role in this company changed. Enter the office again to go on.', action: 'Enter again' },
  kicked: {
    title: 'Removed from the office',
    text: 'You were removed from the office by an admin. You are still a member of the company.',
    action: 'Enter again',
  },
  denied: { title: 'No access', text: 'You cannot enter this office. Ask an admin for an invite.', action: null },
  lost: { title: 'Disconnected', text: 'The connection to the office was lost.', action: 'Reconnect' },
  error: { title: 'Cannot connect', text: 'Could not connect to the office.', action: 'Try again' },
} as const satisfies Record<ClosedReasonKey, { title: string; text: string; action: string | null }>
type ClosedReasonKey = Exclude<ClosedReason, 'signed_out'>

// A modal card over the map and the chat; its button (or link) takes the focus.
function ClosedCard({ reason, detail, onReconnect }: { reason: ClosedReasonKey; detail: string; onReconnect: () => void }) {
  const { title, text, action } = CLOSED_TEXT[reason]
  const card = useRef<HTMLDivElement>(null)
  useEffect(() => card.current?.querySelector<HTMLElement>('button, a')?.focus(), [reason])
  return (
    <div
      style={overlayStyle}
      role="dialog"
      aria-modal="true"
      aria-labelledby="connection-closed-title"
      aria-describedby="connection-closed-text"
      data-testid="connection-closed"
      data-reason={reason}
    >
      <div ref={card} style={cardStyle}>
        <h2 id="connection-closed-title" style={titleStyle}>
          {title}
        </h2>
        <p id="connection-closed-text" style={textStyle} title={detail}>
          {text}
        </p>
        {action ? (
          <button type="button" style={buttonStyle} onClick={onReconnect} data-testid="reconnect">
            {action}
          </button>
        ) : (
          <Link to="/">Go to my offices</Link>
        )}
      </div>
    </div>
  )
}
