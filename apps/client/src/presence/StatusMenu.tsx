import { useRef, useState, type FormEvent } from 'react'
import { CHOSEN_STATUSES, STATUS_TEXT_MAX_LENGTH, type ChosenStatus } from '@vo/shared'
import { notificationPermission } from '../chat/useChat.ts'
import { useEscape } from '../hooks/useEscape.ts'
import { headerButtonStyle } from '../office/headerStyles.ts'
import { useSocial } from '../office/social.tsx'
import { COLORS } from '../ui/pageStyles.ts'
import { fieldStyle, mutedTextStyle, panelButtonStyle, popoverStyle } from './panelStyles.ts'
import { ownStatusLabel, STATUS_LABEL } from './people.ts'
import { StatusDot } from './StatusDot.tsx'

const HINT: Record<ChosenStatus, string> = {
  available: 'Busy shows by itself while you are in a meeting room.',
  busy: 'People see that you are busy.',
  dnd: 'No mention notifications and no waves. Later: no audio or video in open areas.',
}

const PERMISSION_TEXT: Record<string, string> = {
  denied: 'The browser blocks notifications for this site. Allow them in its site settings.',
  unsupported: 'This browser does not show notifications.',
}

// The own status in the header: Available, Busy or DND, a status text, and mention notifications.
export function StatusMenu({ narrow }: { narrow: boolean }) {
  const { link, ownPlayer, prefs, setNotifyMentions } = useSocial()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  // What the user just picked, shown until the room state changes (the server's answer).
  const [picked, setPicked] = useState<{ status: ChosenStatus; statusText: string; from: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [permission, setPermission] = useState(notificationPermission)
  const button = useRef<HTMLButtonElement>(null)

  const close = (): void => {
    setOpen(false)
    setDraft(null)
    setError(null)
    button.current?.focus()
  }
  useEscape(open, close)

  const server = { status: ownPlayer?.chosenStatus ?? 'available', statusText: ownPlayer?.statusText ?? '' }
  const serverKey = `${server.status}\n${server.statusText}`
  const { status: chosen, statusText } = picked && picked.from === serverKey ? picked : server
  const effective = ownPlayer?.status ?? 'available'
  const label = ownStatusLabel(chosen, effective)

  const set = (status: ChosenStatus, text?: string): void => {
    if (!link) return
    setError(null)
    setPicked({ status, statusText: text ?? statusText, from: serverKey })
    if (text !== undefined) setDraft(null)
    link.setStatus(text === undefined ? { status } : { status, statusText: text }).catch(() => {
      setPicked(null)
      setError('Could not change the status. Try again.')
    })
  }

  const saveText = (event: FormEvent): void => {
    event.preventDefault()
    set(chosen, (draft ?? statusText).trim())
  }

  const toggleNotify = (on: boolean): void => {
    setNotifyMentions(on).catch(() => setError('Could not save the setting.'))
    if (on && permission === 'default') void Notification.requestPermission().then(setPermission, () => undefined)
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        style={{ ...headerButtonStyle, display: 'flex', alignItems: 'center', gap: 6, maxWidth: 260, padding: narrow ? '9px 8px' : headerButtonStyle.padding }}
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-controls="status-menu-panel"
        aria-label={`Your status: ${label}${statusText ? `, ${statusText}` : ''}`}
        disabled={!ownPlayer}
        data-testid="status-menu"
        data-status={effective}
        data-chosen-status={chosen}
      >
        <StatusDot status={effective} />
        {!narrow && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{statusText ? `${label} · ${statusText}` : label}</span>}
      </button>
      {open && (
        <section
          id="status-menu-panel"
          role="dialog"
          aria-label="Your status"
          style={{ ...popoverStyle, top: 52, right: 8, width: 'min(320px, calc(100vw - 16px))' }}
          data-testid="status-panel"
        >
          <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
            <legend style={{ fontWeight: 700, marginBottom: 6 }}>Status</legend>
            {CHOSEN_STATUSES.map((status) => (
              <label key={status} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="own-status"
                  value={status}
                  checked={chosen === status}
                  onChange={() => set(status)}
                  autoFocus={chosen === status}
                  data-testid={`status-option-${status}`}
                />
                <StatusDot status={status} />
                {STATUS_LABEL[status]}
              </label>
            ))}
          </fieldset>
          <p style={{ ...mutedTextStyle, margin: '4px 0 10px' }}>
            {effective === 'away' && chosen !== 'dnd'
              ? 'Shown as Away until you are active again.'
              : effective === 'busy' && chosen === 'available'
                ? 'Shown as Busy while you are in a meeting room.'
                : HINT[chosen]}
          </p>
          <form onSubmit={saveText} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label htmlFor="status-text" style={{ fontWeight: 700 }}>
              Status text
            </label>
            <input
              id="status-text"
              style={fieldStyle}
              value={draft ?? statusText}
              maxLength={STATUS_TEXT_MAX_LENGTH}
              placeholder="What are you up to?"
              onChange={(e) => setDraft(e.target.value)}
              data-testid="status-text"
            />
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="submit" style={panelButtonStyle} data-testid="status-text-save">
                Save
              </button>
              {statusText !== '' && (
                <button type="button" style={panelButtonStyle} onClick={() => set(chosen, '')} data-testid="status-text-clear">
                  Clear
                </button>
              )}
            </div>
          </form>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 12 }}>
            <input
              type="checkbox"
              checked={prefs.notifyMentions}
              onChange={(e) => toggleNotify(e.target.checked)}
              data-testid="notify-mentions"
            />
            <span>Notify me of mentions while this tab is hidden (never on Do not disturb)</span>
          </label>
          {prefs.notifyMentions && permission === 'default' && (
            <button
              type="button"
              style={{ ...panelButtonStyle, marginTop: 6 }}
              onClick={() => void Notification.requestPermission().then(setPermission, () => undefined)}
            >
              Allow browser notifications
            </button>
          )}
          {prefs.notifyMentions && PERMISSION_TEXT[permission] && <p style={{ ...mutedTextStyle, margin: '6px 0 0' }}>{PERMISSION_TEXT[permission]}</p>}
          {error && (
            <p role="alert" style={{ color: COLORS.danger, margin: '8px 0 0' }}>
              {error}
            </p>
          )}
        </section>
      )}
    </>
  )
}
