import { useState, type CSSProperties } from 'react'
import type { InviteRole } from '@vo/shared'
import { errorMessage } from '../api/http.ts'
import { useMediaQuery } from '../hooks/useMediaQuery.ts'

export const HEADER_HEIGHT = 48

const font = 'system-ui, -apple-system, "Segoe UI", sans-serif'

const headerStyle: CSSProperties = {
  height: HEADER_HEIGHT,
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '0 12px',
  background: '#141820',
  color: '#ffffff',
  fontFamily: font,
  fontSize: 14,
  whiteSpace: 'nowrap',
}

const titleStyle: CSSProperties = { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }

const buttonStyle: CSSProperties = {
  padding: '6px 10px',
  border: '1px solid rgba(255, 255, 255, 0.25)',
  borderRadius: 6,
  background: 'transparent',
  color: '#ffffff',
  fontFamily: font,
  fontSize: 13,
  cursor: 'pointer',
}

const selectStyle: CSSProperties = { ...buttonStyle, padding: '5px 6px', background: '#141820' }

export interface OfficeHeaderProps {
  companyName: string
  officeName: string
  userName: string
  // Owners and admins only; returns the invite URL.
  createInvite: ((role: InviteRole) => Promise<string>) | null
  onSignOut: () => void
}

export function OfficeHeader({ companyName, officeName, userName, createInvite, onSignOut }: OfficeHeaderProps) {
  const narrow = useMediaQuery('(max-width: 640px)')
  return (
    <header style={narrow ? { ...headerStyle, gap: 8, padding: '0 8px' } : headerStyle} data-testid="office-header">
      <div style={titleStyle} title={`${companyName} · ${officeName}`}>
        <strong data-testid="company-name">{companyName}</strong>
        <span style={{ opacity: 0.7 }}> · </span>
        <span data-testid="office-name">{officeName}</span>
      </div>
      {createInvite && <InviteControl createInvite={createInvite} narrow={narrow} />}
      {!narrow && (
        <span data-testid="user-name" style={{ opacity: 0.85 }}>
          {userName}
        </span>
      )}
      <button type="button" style={buttonStyle} onClick={onSignOut} data-testid="sign-out">
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
          setStatus({ text: 'Invite link copied' })
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
        <span data-testid="invite-status" style={{ fontSize: 12, opacity: 0.85 }}>
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
        onChange={(e) => setRole(e.target.value === 'guest' ? 'guest' : 'member')}
      >
        <option value="member">Member</option>
        <option value="guest">Guest</option>
      </select>
      <button type="button" style={buttonStyle} onClick={copy} disabled={busy} data-testid="copy-invite">
        {narrow ? (status && !status.url ? 'Copied' : 'Invite') : 'Copy invite link'}
      </button>
    </div>
  )
}
