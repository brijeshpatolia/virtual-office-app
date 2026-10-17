import { useEffect, useState, type CSSProperties } from 'react'
import { PhaserGame } from '../game/PhaserGame.tsx'
import type { OfficeScene } from '../game/scenes/OfficeScene.ts'
import { Link } from '../router/navigation.tsx'
import { Hud } from '../ui/Hud.tsx'
import { pillStyle } from '../ui/hudStyles.ts'
import { buttonStyle, cardStyle, textStyle, titleStyle } from '../ui/pageStyles.ts'
import { HEADER_HEIGHT, OfficeHeader, type OfficeHeaderProps } from './OfficeHeader.tsx'
import type { ConnectionState } from './officeConnection.ts'

const rootStyle: CSSProperties = { position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }
const stageStyle: CSSProperties = { position: 'absolute', top: HEADER_HEIGHT, left: 0, right: 0, bottom: 0, overflow: 'hidden' }
const bannerStyle: CSSProperties = {
  ...pillStyle,
  position: 'absolute',
  top: 12,
  right: 12,
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
}
const overlayStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
  background: 'rgba(20, 24, 32, 0.45)',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
}

export interface OfficeViewProps extends OfficeHeaderProps {
  connection: ConnectionState
  onReconnect: () => void
}

// The office page: header, the map with the avatars, the HUD and the connection state.
export function OfficeView({ connection, onReconnect, ...header }: OfficeViewProps) {
  const [scene, setScene] = useState<OfficeScene | null>(null)
  const link = connection.kind === 'connected' ? connection.link : null

  useEffect(() => {
    if (!scene || !link) return
    scene.attach(link)
    return () => scene.detach()
  }, [scene, link])

  return (
    <div style={rootStyle}>
      <OfficeHeader {...header} />
      <div style={stageStyle}>
        <PhaserGame onReady={setScene} />
        <Hud />
        <ConnectionStatus state={connection} onReconnect={onReconnect} />
      </div>
    </div>
  )
}

function ConnectionStatus({ state, onReconnect }: { state: ConnectionState; onReconnect: () => void }) {
  switch (state.kind) {
    case 'idle':
      return null
    case 'connecting':
      return (
        <div style={bannerStyle} data-testid="connection-status">
          Connecting to the office…
        </div>
      )
    case 'connected':
      return state.reconnecting ? (
        <div style={bannerStyle} data-testid="connection-status">
          Connection lost. Reconnecting…
        </div>
      ) : null
    case 'closed':
      return <ClosedCard reason={state.reason} detail={state.detail} onReconnect={onReconnect} />
  }
}

const CLOSED_TEXT = {
  replaced: { title: 'Open in another tab', text: 'You opened this office in another tab or window.', action: 'Use this tab' },
  removed: { title: 'No access', text: 'You no longer have access to this office.', action: null },
  denied: { title: 'No access', text: 'You cannot enter this office. Ask an admin for an invite.', action: null },
  lost: { title: 'Disconnected', text: 'The connection to the office was lost.', action: 'Reconnect' },
  error: { title: 'Cannot connect', text: 'Could not connect to the office.', action: 'Try again' },
} as const

function ClosedCard({ reason, detail, onReconnect }: { reason: keyof typeof CLOSED_TEXT; detail: string; onReconnect: () => void }) {
  const { title, text, action } = CLOSED_TEXT[reason]
  return (
    <div style={overlayStyle} data-testid="connection-closed" data-reason={reason}>
      <div style={cardStyle}>
        <h2 style={titleStyle}>{title}</h2>
        <p style={textStyle} title={detail}>
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
