import { useEffect, useRef, useState } from 'react'
import { rejectReason } from '@vo/shared'
import { shortTime } from '../chat/format.ts'
import { EventBus } from '../game/EventBus.ts'
import { useEscape } from '../hooks/useEscape.ts'
import { useSocial } from '../office/social.tsx'
import { COLORS } from '../ui/pageStyles.ts'
import { dangerButtonStyle, disabledStyle, fieldStyle, mutedTextStyle, panelButtonStyle, popoverStyle } from './panelStyles.ts'
import { canModerate, mergePeople, MUTE_CHOICES, ROLE_LABEL, STATUS_LABEL } from './people.ts'
import { StatusDot } from './StatusDot.tsx'

const ADMIN_ERROR: Record<string, string> = {
  not_allowed: 'You cannot do that to this person.',
  not_found: 'They are not in the office (or no longer a member).',
}

// Name, role, status and status text of one person, with Wave and Block, and Mute and Kick for owners and admins.
export function ProfileCard() {
  const social = useSocial()
  const { profileUserId, closeProfile } = social
  // A new card per person, so its state (confirm step, notices) starts fresh.
  return profileUserId ? <Card key={profileUserId} userId={profileUserId} onClose={closeProfile} /> : null
}

function Card({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { members, players, self, link, blocked, setBlocked, prefsStatus } = useSocial()
  const person = mergePeople(members, players, self.userId).find((p) => p.userId === userId)
  const card = useRef<HTMLElement>(null)
  const opener = useRef<Element | null>(null)
  const [confirmKick, setConfirmKick] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    opener.current = document.activeElement
    card.current?.querySelector<HTMLElement>('h2')?.focus()
    return () => {
      const back = opener.current
      if (back instanceof HTMLElement && back.isConnected && back !== document.body) back.focus()
    }
  }, [])
  useEscape(true, onClose)

  if (!person) {
    return (
      <section ref={card} role="dialog" aria-label="Profile" style={{ ...popoverStyle, top: 12, left: 12, width: 260 }} data-testid="profile-card" data-user-id={userId}>
        <h2 tabIndex={-1} style={{ margin: '0 0 8px', fontSize: 16 }}>
          Unknown person
        </h2>
        <button type="button" style={panelButtonStyle} onClick={onClose}>
          Close
        </button>
      </section>
    )
  }

  const isBlocked = blocked.has(userId)
  const targetDnd = person.status === 'dnd'
  const canWave = !person.self && person.online && !isBlocked && !targetDnd && link !== null
  const waveTitle = person.self
    ? 'You cannot wave at yourself'
    : !person.online
      ? 'Not in the office'
      : isBlocked
        ? 'You blocked this person'
        : targetDnd
          ? 'They do not want to be disturbed'
          : undefined
  const moderate =
    link !== null && person.role !== null && canModerate({ userId: self.userId, role: self.role }, { userId, role: person.role })

  const run = (action: () => Promise<string | undefined>): void => {
    setBusy(true)
    setNotice(null)
    action()
      .then((text) => text && setNotice({ text, error: false }))
      .catch((error: unknown) => setNotice({ text: ADMIN_ERROR[rejectReason(error) ?? ''] ?? 'That did not work. Try again.', error: true }))
      .finally(() => setBusy(false))
  }

  const wave = (): void => {
    link?.wave(userId)
    EventBus.emit('toast', `You waved at ${person.name}`)
  }

  const toggleBlock = (): void =>
    run(async () => {
      await setBlocked(userId, !isBlocked)
      return isBlocked ? `${person.name} is unblocked.` : `${person.name} is blocked. You no longer see their messages, and no waves or mentions go between you.`
    })

  const mute = (minutes: number): void =>
    run(async () => {
      const until = (await link?.mute(userId, minutes)) ?? null
      return until ? `${person.name} is muted until ${shortTime(until)}.` : `${person.name} is unmuted.`
    })

  const kick = (): void =>
    run(async () => {
      await link?.kick(userId)
      setConfirmKick(false)
      return `${person.name} was removed from the office. They can enter again.`
    })

  return (
    <section
      ref={card}
      role="dialog"
      aria-labelledby="profile-card-name"
      style={{ ...popoverStyle, top: 12, left: 12, width: 'min(300px, calc(100% - 24px))' }}
      data-testid="profile-card"
      data-user-id={userId}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <StatusDot status={person.status} size={12} />
        <h2 id="profile-card-name" tabIndex={-1} style={{ flex: 1, margin: 0, fontSize: 16, overflowWrap: 'anywhere' }}>
          {person.name}
          {person.self && <span style={{ ...mutedTextStyle, fontWeight: 400 }}> (you)</span>}
        </h2>
        <button type="button" style={panelButtonStyle} onClick={onClose} aria-label="Close the profile" data-testid="profile-close">
          ×
        </button>
      </div>
      <p style={{ margin: '6px 0 0' }} data-testid="profile-status">
        {person.status ? STATUS_LABEL[person.status] : 'Offline'}
        {person.role && <span style={mutedTextStyle}> · {ROLE_LABEL[person.role]}</span>}
      </p>
      {person.statusText && (
        <p style={{ margin: '4px 0 0', fontStyle: 'italic', overflowWrap: 'anywhere' }} data-testid="profile-status-text">
          {person.statusText}
        </p>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
        <button
          type="button"
          style={disabledStyle(panelButtonStyle, !canWave)}
          onClick={wave}
          disabled={!canWave}
          title={waveTitle}
          data-testid="profile-wave"
        >
          Wave
        </button>
        {!person.self && (
          <button
            type="button"
            style={isBlocked ? panelButtonStyle : dangerButtonStyle}
            onClick={toggleBlock}
            // Until the block list is loaded, Block or Unblock could be the wrong one.
            disabled={busy || prefsStatus !== 'ready'}
            data-testid="profile-block"
          >
            {isBlocked ? 'Unblock' : 'Block'}
          </button>
        )}
      </div>
      {moderate && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${COLORS.line}` }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontWeight: 600 }}>Mute chat</span>
            <select
              style={{ ...fieldStyle, width: 'auto', flex: 1 }}
              value=""
              disabled={busy}
              onChange={(e) => {
                const minutes = Number(e.target.value)
                // Back to the map, so the arrow keys walk again.
                e.target.blur()
                if (Number.isInteger(minutes)) mute(minutes)
              }}
              data-testid="profile-mute"
            >
              <option value="" disabled>
                Choose…
              </option>
              {MUTE_CHOICES.map((choice) => (
                <option key={choice.minutes} value={choice.minutes}>
                  for {choice.label}
                </option>
              ))}
              <option value="0">Unmute</option>
            </select>
          </label>
          {person.online && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              {confirmKick ? (
                <>
                  <span>Remove {person.name} from the office? They stay a member.</span>
                  <button type="button" style={dangerButtonStyle} onClick={kick} disabled={busy} data-testid="profile-kick-confirm">
                    Kick
                  </button>
                  <button type="button" style={panelButtonStyle} onClick={() => setConfirmKick(false)}>
                    Cancel
                  </button>
                </>
              ) : (
                <button type="button" style={dangerButtonStyle} onClick={() => setConfirmKick(true)} data-testid="profile-kick">
                  Kick from the office
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {notice && (
        <p role={notice.error ? 'alert' : 'status'} style={{ margin: '8px 0 0', color: notice.error ? COLORS.danger : COLORS.muted }} data-testid="profile-notice">
          {notice.text}
        </p>
      )}
    </section>
  )
}
