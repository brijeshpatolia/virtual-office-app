import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import { useEscape } from '../hooks/useEscape.ts'
import { useSocial } from '../office/social.tsx'
import { COLORS } from '../ui/pageStyles.ts'
import { mutedTextStyle, panelButtonStyle, popoverStyle } from './panelStyles.ts'
import { mergePeople, ROLE_LABEL, STATUS_LABEL, type Person } from './people.ts'
import { StatusDot } from './StatusDot.tsx'

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '6px 4px',
  border: 'none',
  borderTop: `1px solid ${COLORS.line}`,
  background: 'none',
  color: COLORS.ink,
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
}

// The company's members (guests: the people in the room), online first with their status. A row opens the card.
export function PeoplePanel({ onClose }: { onClose: () => void }) {
  const { members, players, self, openProfile } = useSocial()
  const people = useMemo(() => mergePeople(members, players, self.userId), [members, players, self.userId])
  const panel = useRef<HTMLElement>(null)
  useEscape(true, onClose)
  useEffect(() => panel.current?.querySelector<HTMLElement>('button')?.focus(), [])
  const online = people.filter((p) => p.online).length

  return (
    <section
      ref={panel}
      id="people-panel"
      aria-label="People"
      style={{ ...popoverStyle, top: 52, right: 8, width: 'min(300px, calc(100vw - 16px))', maxHeight: 'calc(100% - 140px)', overflowY: 'auto' }}
      data-testid="people-panel"
    >
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
        <strong style={{ flex: 1 }}>
          People · {online} online{members ? ` of ${people.length}` : ''}
        </strong>
        <button type="button" style={panelButtonStyle} onClick={onClose}>
          Close
        </button>
      </div>
      {self.role === 'guest' && <p style={{ ...mutedTextStyle, margin: '0 0 6px' }}>As a guest you see the people in the office now.</p>}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {people.map((person) => (
          <li key={person.userId}>
            <PersonRow person={person} onOpen={() => openProfile(person.userId)} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function PersonRow({ person, onOpen }: { person: Person; onOpen: () => void }) {
  const status = person.status ? STATUS_LABEL[person.status] : 'Offline'
  return (
    <button
      type="button"
      style={{ ...rowStyle, opacity: person.online ? 1 : 0.7 }}
      onClick={onOpen}
      data-testid="person-row"
      data-user-id={person.userId}
      data-online={person.online}
      data-status={person.status ?? 'offline'}
    >
      <StatusDot status={person.status} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontWeight: 600 }}>{person.name}</span>
        {person.self && <span style={mutedTextStyle}> (you)</span>}
        <span style={{ ...mutedTextStyle, display: 'block', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {status}
          {person.role ? ` · ${ROLE_LABEL[person.role]}` : ''}
          {person.statusText ? ` · ${person.statusText}` : ''}
        </span>
      </span>
    </button>
  )
}
