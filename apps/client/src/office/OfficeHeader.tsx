import { useState, type CSSProperties, type ReactNode } from 'react'
import type { InviteLinkSummary, InviteRole } from '@vo/shared'
import { errorMessage } from '../api/http.ts'
import { useMediaQuery } from '../hooks/useMediaQuery.ts'
import { headerButtonStyle, headerFont } from './headerStyles.ts'
import { InviteLinksPanel } from './InviteLinksPanel.tsx'

export const HEADER_HEIGHT = 48

const headerStyle: CSSProperties = {
  flex: '0 0 auto',
  height: HEADER_HEIGHT,
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '0 12px',
  background: '#141820',
  color: '#ffffff',
  fontFamily: headerFont,
  fontSize: 14,
  whiteSpace: 'nowrap',
}

const titleStyle: CSSProperties = { flex: '1 1 auto', minWidth: 48, overflow: 'hidden', textOverflow: 'ellipsis' }

const selectStyle: CSSProperties = { ...headerButtonStyle, padding: '5px 6px', background: '#141820' }

// Owners and admins only.
export interface InviteActions {
  // A new invite link; resolves its URL.
  create(role: InviteRole): Promise<string>
  // The links that still let someone join.
  list(): Promise<InviteLinkSummary[]>
  revoke(linkId: string): Promise<void>
}

export interface OfficeHeaderProps {
  companyName: string
  officeName: string
  userName: string
  invites: InviteActions | null
  onSignOut: () => void
}

// presence: the status menu and the People button.
export function OfficeHeader({ companyName, officeName, userName, invites, onSignOut, presence }: OfficeHeaderProps & { presence?: ReactNode }) {
  const narrow = useMediaQuery('(max-width: 640px)')
  return (
    <header style={narrow ? { ...headerStyle, gap: 6, padding: '0 8px', overflowX: 'auto' } : headerStyle} data-testid="office-header">
      <div style={titleStyle} title={`${companyName} · ${officeName}`}>
        <strong data-testid="company-name">{companyName}</strong>
        <span style={{ opacity: 0.7 }}> · </span>
        <span data-testid="office-name">{officeName}</span>
      </div>
      {invites && <InviteControl createInvite={invites.create} narrow={narrow} />}
      {invites && <InviteLinksPanel invites={invites} />}
      {presence}
      {!narrow && (
        <span data-testid="user-name" style={{ opacity: 0.85 }}>
          {userName}
        </span>
      )}
      <button type="button" style={headerButtonStyle} onClick={onSignOut} data-testid="sign-out">
        Sign out
      </button>
    </header>
  )
}

// A clipboard write can wait forever for a permission (headless browsers, some embeds); give up after a moment.
function copyText(text: string): Promise<void> {
  return Promise.race([
    navigator.clipboard.writeText(text),
    new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('Clipboard timeout')), 1500)),
  ])
}

const ROLE_LABEL: Record<InviteRole, string> = { member: 'Member', guest: 'Guest' }

function InviteControl({ createInvite, narrow }: { createInvite: (role: InviteRole) => Promise<string>; narrow: boolean }) {
  const [role, setRole] = useState<InviteRole>('member')
  const [status, setStatus] = useState<{ text: string; url?: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const copy = (): void => {
    setBusy(true)
    setStatus(null)
    createInvite(role)
      .then(async (url) => {
        try {
          await copyText(url)
          setStatus({ text: `${ROLE_LABEL[role]} invite link copied` })
        } catch {
          // No clipboard permission (or not a secure context): show the link to copy by hand.
          setStatus({ text: 'Copy this link:', url })
        }
      })
      .catch((e: unknown) => setStatus({ text: errorMessage(e) }))
      .finally(() => setBusy(false))
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {status && (!narrow || status.url) && (
        <span data-testid="invite-status" role="status" style={{ fontSize: 12, opacity: 0.85 }}>
          {status.text}
          {status.url && (
            <input
              readOnly
              value={status.url}
              onFocus={(e) => e.target.select()}
              style={{ marginLeft: 6, width: narrow ? 90 : 220, fontSize: 12 }}
              data-testid="invite-url"
            />
          )}
        </span>
      )}
      <select
        aria-label="Invite as"
        style={selectStyle}
        value={role}
        onChange={(e) => {
          setRole(e.target.value === 'guest' ? 'guest' : 'member')
          setStatus(null)
          // Back to the map, so the arrow keys walk again instead of changing the role.
          e.target.blur()
        }}
        data-testid="invite-role"
      >
        <option value="member">Member</option>
        <option value="guest">Guest</option>
      </select>
      <button type="button" style={headerButtonStyle} onClick={copy} disabled={busy} data-testid="copy-invite">
        {narrow ? (status && !status.url ? 'Copied' : 'Invite') : 'Copy invite link'}
      </button>
    </div>
  )
}
