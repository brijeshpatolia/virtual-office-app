import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { InviteLinkSummary } from '@vo/shared'
import { errorMessage } from '../api/http.ts'
import { headerButtonStyle, headerFont } from './headerStyles.ts'
import type { InviteActions } from './OfficeHeader.tsx'

const panelStyle: CSSProperties = {
  position: 'absolute',
  top: 52,
  right: 8,
  zIndex: 10,
  width: 'min(360px, calc(100vw - 16px))',
  boxSizing: 'border-box',
  padding: 12,
  borderRadius: 8,
  background: '#ffffff',
  color: '#141820',
  boxShadow: '0 8px 30px rgba(20, 24, 32, 0.25)',
  fontFamily: headerFont,
  fontSize: 13,
  whiteSpace: 'normal',
}
const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid #d6dbe3' }
const revokeStyle: CSSProperties = { ...headerButtonStyle, color: '#c62828', borderColor: '#d6dbe3', padding: '4px 8px' }

const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

function describe(link: InviteLinkSummary): string {
  const uses = link.maxUses === null ? `${link.uses} used` : `${link.uses} of ${link.maxUses} used`
  return `${link.role === 'guest' ? 'Guest' : 'Member'} · ${uses} · until ${dateFormat.format(new Date(link.expiresAt))} · by ${link.createdBy}`
}

// "Links": the invite links that still let someone in, each with Revoke. Owners and admins only.
export function InviteLinksPanel({ invites }: { invites: InviteActions }) {
  const [open, setOpen] = useState(false)
  const [links, setLinks] = useState<InviteLinkSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const button = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    let live = true
    invites.list().then(
      (list) => live && setLinks(list),
      (e: unknown) => live && setError(errorMessage(e)),
    )
    return () => {
      live = false
    }
  }, [open, invites, version])

  const close = useCallback((): void => {
    setOpen(false)
    setLinks(null)
    setError(null)
    button.current?.focus()
  }, [])

  // Escape closes it, wherever the focus is (a revoked row takes its button with it).
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, close])

  const revoke = (linkId: string): void => {
    setError(null)
    invites.revoke(linkId).then(
      () => setVersion((v) => v + 1),
      (e: unknown) => setError(errorMessage(e)),
    )
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        style={headerButtonStyle}
        aria-expanded={open}
        aria-controls="invite-links-panel"
        onClick={() => (open ? close() : setOpen(true))}
        data-testid="invite-links"
      >
        Links
      </button>
      {open && (
        <section
          id="invite-links-panel"
          aria-label="Open invite links"
          style={panelStyle}
          data-testid="invite-links-panel"
        >
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
            <strong style={{ flex: 1 }}>Open invite links</strong>
            <button type="button" style={{ ...revokeStyle, color: '#141820' }} onClick={close} autoFocus>
              Close
            </button>
          </div>
          {error && (
            <p role="alert" style={{ margin: '4px 0', color: '#c62828' }}>
              {error}
            </p>
          )}
          {links === null && !error && <p style={{ margin: '4px 0' }}>Loading…</p>}
          {links?.length === 0 && <p style={{ margin: '4px 0' }}>No open links. Revoked, expired and used-up links do not show.</p>}
          {links?.map((link) => (
            <div key={link.id} style={rowStyle} data-testid="invite-link-row">
              <span style={{ flex: 1 }}>{describe(link)}</span>
              <button type="button" style={revokeStyle} onClick={() => revoke(link.id)} data-testid="revoke-invite">
                Revoke
              </button>
            </div>
          ))}
        </section>
      )}
    </>
  )
}
