import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { unreadBadge } from '@vo/shared'
import { useDocumentVisible } from '../hooks/useDocumentVisible.ts'
import { useMediaQuery } from '../hooks/useMediaQuery.ts'
import { useSocial } from '../office/social.tsx'
import { ROLE_LABEL } from '../presence/people.ts'
import { badgeStyle, barLineStyle, barStyle, errorStyle, linkLikeStyle, mentionBadgeStyle, metaStyle, smallButtonStyle } from './chatStyles.ts'
import { ChatComposer } from './ChatComposer.tsx'
import { shortDate, shortTime } from './format.ts'
import { focusesChat } from './keys.ts'
import { EVERYONE_CANDIDATE, withDetails, type MentionCandidate } from './mentions.ts'
import { MessageList } from './MessageList.tsx'
import { chatRows } from './messages.ts'
import { plainText } from './segments.ts'
import { isReading } from './unread.ts'
import { notificationPermission, useChat } from './useChat.ts'

const EXPANDED_KEY = 'vo.chat.expanded'

function readExpanded(): boolean {
  try {
    return window.localStorage.getItem(EXPANDED_KEY) === '1'
  } catch {
    return false
  }
}

function saveExpanded(expanded: boolean): void {
  try {
    window.localStorage.setItem(EXPANDED_KEY, expanded ? '1' : '0')
  } catch {
    // Private mode or blocked storage: the bar just forgets.
  }
}

// R5: the office chat, fixed under the map and never hidden. Collapsed it is one line with the newest message
// and the unread badge; open it shows the messages and the input. Enter on the map opens it and focuses the input.
export function ChatBar({ reconnecting }: { reconnecting: boolean }) {
  const social = useSocial()
  const { self, players, members, blocked, nameOf: memberName, link, openProfile } = social
  const { model, snapshot } = useChat(social, reconnecting)
  const [expanded, setExpanded] = useState(readExpanded)
  const [atBottom, setAtBottom] = useState(true)
  const [focusRequest, setFocusRequest] = useState(0)
  const [scrollRequest, setScrollRequest] = useState(0)
  const [permission, setPermission] = useState(notificationPermission)
  // The newest live message from someone else, for screen readers (the list itself is not a live region).
  const [announcement, setAnnouncement] = useState('')
  const visible = useDocumentVisible()
  const narrow = useMediaQuery('(max-width: 640px)')
  const { history, pending, unread } = snapshot

  const expand = (open: boolean): void => {
    setExpanded(open)
    saveExpanded(open)
    if (open) setAtBottom(true)
  }

  useEffect(() => model.setReading(isReading({ expanded, atBottom, visible })), [model, expanded, atBottom, visible])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || !focusesChat(event, event.target) || document.querySelector('[aria-modal="true"]')) return
      event.preventDefault()
      // As expand(true): the list opens at the newest message, so it counts as read.
      setExpanded(true)
      saveExpanded(true)
      setAtBottom(true)
      setFocusRequest((n) => n + 1)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  // Names for mentions: members, the people in the room, then the authors of loaded messages. It changes only when a
  // name does, so the message rows (memoized) do not render again for every new message.
  const authorsKey = useMemo(() => JSON.stringify([...new Map(history.messages.map((m) => [m.authorId, m.authorName]))]), [history.messages])
  const nameOf = useMemo(() => {
    const authors = new Map(JSON.parse(authorsKey) as [string, string][])
    return (userId: string): string | undefined => memberName(userId) ?? authors.get(userId)
  }, [memberName, authorsKey])
  const latestNameOf = useRef(nameOf)
  useEffect(() => {
    latestNameOf.current = nameOf
  })

  // The people to mention, without the user and the people they blocked (no mentions go between them). Names that
  // more than one person has get their role, where they are and the end of their id, so the list tells them apart.
  const candidates = useMemo<MentionCandidate[]>(() => {
    const online = new Set(players.map((p) => p.userId))
    const memberOf = new Map((members ?? []).map((m) => [m.userId, m]))
    const people = new Map<string, MentionCandidate>()
    for (const member of members ?? []) people.set(member.userId, { id: member.userId, label: member.name })
    for (const player of players) people.set(player.userId, { id: player.userId, label: player.name })
    people.delete(self.userId)
    for (const id of blocked) people.delete(id)
    const list = withDetails([...people.values()], ({ id }) => {
      const member = memberOf.get(id)
      const where = online.has(id) ? 'in the office' : member ? `joined ${shortDate(member.joinedAt)}` : ''
      return [member ? ROLE_LABEL[member.role] : '', where, `#${id.slice(-4)}`].filter((part) => part !== '').join(', ')
    })
    return self.role === 'guest' ? list : [EVERYONE_CANDIDATE, ...list]
  }, [members, players, blocked, self.userId, self.role])

  useEffect(
    () =>
      model.onIncoming((message) => {
        setAnnouncement(`${message.authorName}: ${plainText(message.body, latestNameOf.current)}`.slice(0, 300))
      }),
    [model],
  )

  const rows = useMemo(() => chatRows(history.messages, blocked), [history.messages, blocked])
  const latest = [...history.messages].reverse().find((m) => m.deletedAt === null && !blocked.has(m.authorId))
  const canDeleteAll = self.role === 'owner' || self.role === 'admin'
  // The model clears it when the mute ends. Sends still go out: the server decides (it may have unmuted the user
  // while this page did not hear of it) and answers 'muted' with the end.
  const muted = snapshot.mutedUntil !== null
  const prefsStatus = social.prefsStatus

  const onDelete = useCallback((id: string) => void model.delete(id), [model])
  const onRetry = useCallback((clientMsgId: string) => model.retry(clientMsgId), [model])
  const onDiscard = useCallback((clientMsgId: string) => model.discard(clientMsgId), [model])
  const onLoadOlder = useCallback(() => void model.loadOlder(), [model])
  const onRetryLoad = useCallback(() => void model.refresh(), [model])

  const send = (body: string): boolean => {
    const sent = model.send(body)
    if (sent) {
      setAtBottom(true)
      setScrollRequest((n) => n + 1)
    }
    return sent
  }

  const askPermission = (): void => {
    void Notification.requestPermission().then(setPermission, () => undefined)
  }

  return (
    <section style={barStyle} aria-label="Office chat" data-testid="chat-bar" data-expanded={expanded}>
      <div style={barLineStyle}>
        <button
          type="button"
          style={{ ...smallButtonStyle, fontWeight: 600 }}
          onClick={() => expand(!expanded)}
          aria-expanded={expanded}
          aria-controls="chat-panel"
          data-testid="chat-toggle"
        >
          {expanded ? 'Chat ▾' : 'Chat ▴'}
        </button>
        {unread.count > 0 && (
          <span style={badgeStyle} data-testid="chat-unread" aria-label={`${unreadBadge(unread.count)} unread messages`}>
            {unreadBadge(unread.count)}
          </span>
        )}
        {unread.mentions > 0 && (
          <span style={mentionBadgeStyle} data-testid="chat-unread-mentions" aria-label={`${unreadBadge(unread.mentions)} unread mentions`}>
            @{unreadBadge(unread.mentions)}
          </span>
        )}
        {expanded ? (
          <span style={{ ...metaStyle, flex: 1, marginLeft: 0 }}>Everyone in the office</span>
        ) : (
          <button
            type="button"
            style={{ ...linkLikeStyle, fontWeight: 400, flex: 1, minWidth: 0, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            onClick={() => {
              expand(true)
              setFocusRequest((n) => n + 1)
            }}
            data-testid="chat-preview"
          >
            {latest ? (
              <>
                <strong>{latest.authorName}:</strong> {plainText(latest.body, nameOf)}
              </>
            ) : (
              <span style={metaStyle}>No messages yet</span>
            )}
          </button>
        )}
        {!expanded && !narrow && <span style={{ ...metaStyle, whiteSpace: 'nowrap' }}>Enter to chat</span>}
        {expanded && permission === 'default' && social.prefs.notifyMentions && (
          <button type="button" style={smallButtonStyle} onClick={askPermission} data-testid="chat-notify">
            Notify me of mentions
          </button>
        )}
      </div>
      {/* The composer stays mounted while the bar is collapsed, so a draft survives. */}
      <div id="chat-panel" hidden={!expanded}>
        {expanded && (
          <MessageList
            rows={rows}
            pending={pending}
            selfId={self.userId}
            selfName={social.ownPlayer?.name ?? self.name}
            canDeleteAll={canDeleteAll}
            nameOf={nameOf}
            hasOlder={history.loaded && history.nextBefore !== null}
            loaded={history.loaded}
            loadingOlder={snapshot.loadingOlder}
            loadError={snapshot.loadError}
            unread={unread.count}
            scrollRequest={scrollRequest}
            onLoadOlder={onLoadOlder}
            onRetryLoad={onRetryLoad}
            onAtBottom={setAtBottom}
            onDelete={onDelete}
            onRetry={onRetry}
            onDiscard={onDiscard}
            onAuthor={openProfile}
          />
        )}
        <div className="vo-sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="chat-announcement">
          {expanded ? announcement : ''}
        </div>
        {expanded && (snapshot.error || muted || reconnecting || !link || prefsStatus === 'error') && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px 0' }}>
            {snapshot.error && (
              <span role="alert" style={errorStyle} data-testid="chat-error">
                {snapshot.error}
              </span>
            )}
            {muted && !snapshot.error && (
              <span role="status" style={errorStyle} data-testid="chat-muted">
                You are muted until {shortTime(snapshot.mutedUntil ?? '')}.
              </span>
            )}
            {(reconnecting || !link) && <span style={metaStyle}>Not connected: messages go out when the connection is back.</span>}
            {link && !reconnecting && prefsStatus === 'error' && (
              <span style={errorStyle} data-testid="chat-prefs-error">
                Could not load your settings (blocks). The chat shows once they load; trying again…
              </span>
            )}
            {snapshot.error && (
              <button type="button" style={smallButtonStyle} onClick={() => model.setError(null)} aria-label="Dismiss the error">
                ×
              </button>
            )}
          </div>
        )}
        <ChatComposer candidates={candidates} focusRequest={focusRequest} onSend={send} />
      </div>
    </section>
  )
}
