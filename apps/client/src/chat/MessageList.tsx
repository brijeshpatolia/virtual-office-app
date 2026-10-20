import { memo, useLayoutEffect, useRef, useState, type UIEvent } from 'react'
import type { ChatMessage } from '@vo/shared'
import { unreadBadge } from '@vo/shared'
import type { PendingMessage } from './chatModel.ts'
import { badgeStyle, errorStyle, linkLikeStyle, listStyle, mentionRowStyle, metaStyle, noteStyle, rowStyle, smallButtonStyle } from './chatStyles.ts'
import { fullTime, shortTime } from './format.ts'
import { MessageBody } from './MessageBody.tsx'
import { blockedRowText, type ChatRow } from './messages.ts'

// Within this many px of the end the list counts as scrolled to the bottom; this close to the top it loads older.
const BOTTOM_SLACK = 24
const TOP_LOAD = 48

export interface MessageListProps {
  rows: readonly ChatRow[]
  pending: readonly PendingMessage[]
  selfId: string
  selfName: string
  canDeleteAll: boolean
  nameOf(userId: string): string | undefined
  hasOlder: boolean
  loaded: boolean
  loadingOlder: boolean
  loadError: string | null
  unread: number
  // Scrolls to the newest message each time it changes (the user sent a message).
  scrollRequest: number
  onLoadOlder(): void
  onRetryLoad(): void
  onAtBottom(atBottom: boolean): void
  onDelete(id: string): void
  onRetry(clientMsgId: string): void
  onDiscard(clientMsgId: string): void
  onAuthor(userId: string): void
}

// The list. Its rows are memoized: with stable callbacks and nameOf (ChatBar), a new message renders one row.
// It is not a live region (history pages would be read out); ChatBar announces live messages on their own.
export function MessageList(props: MessageListProps) {
  const { rows, pending, hasOlder, loadingOlder, onLoadOlder, onAtBottom } = props
  const { selfId, selfName, canDeleteAll, nameOf, onDelete, onRetry, onDiscard, onAuthor } = props
  const list = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  // Set before an older page loads: keeps the visible messages in place when it lands above them.
  const anchor = useRef<{ height: number; top: number; first: string | undefined } | null>(null)
  const [showJump, setShowJump] = useState(false)
  const first = rows[0] && (rows[0].kind === 'message' ? rows[0].message.id : rows[0].key)

  useLayoutEffect(() => {
    if (props.scrollRequest > 0) atBottom.current = true
  }, [props.scrollRequest])

  useLayoutEffect(() => {
    const el = list.current
    if (!el) return
    const kept = anchor.current
    if (kept && kept.first !== first) {
      el.scrollTop = el.scrollHeight - kept.height + kept.top
      anchor.current = null
    } else if (atBottom.current) {
      el.scrollTop = el.scrollHeight
    }
    if (kept && !loadingOlder) anchor.current = null
  }, [rows, pending, first, loadingOlder, props.scrollRequest])

  const loadOlder = (): void => {
    const el = list.current
    if (!el || !hasOlder || loadingOlder) return
    anchor.current = { height: el.scrollHeight, top: el.scrollTop, first }
    onLoadOlder()
  }

  const onScroll = (event: UIEvent<HTMLDivElement>): void => {
    const el = event.currentTarget
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK
    if (bottom !== atBottom.current) {
      atBottom.current = bottom
      onAtBottom(bottom)
    }
    setShowJump(!bottom)
    if (el.scrollTop < TOP_LOAD) loadOlder()
  }

  const jump = (): void => {
    const el = list.current
    if (el) el.scrollTop = el.scrollHeight
  }

  return (
    <div style={{ position: 'relative' }}>
      <div
        ref={list}
        style={listStyle}
        onScroll={onScroll}
        role="region"
        aria-busy={loadingOlder}
        aria-label="Office chat messages"
        tabIndex={0}
        data-own-keys=""
        data-testid="chat-list"
      >
        <div style={{ marginTop: 'auto', textAlign: 'center', padding: '4px 0' }}>
          {hasOlder ? (
            <button type="button" style={smallButtonStyle} onClick={loadOlder} disabled={loadingOlder} data-testid="chat-load-older">
              {loadingOlder ? 'Loading…' : 'Load older messages'}
            </button>
          ) : (
            props.loaded && <span style={noteStyle}>{rows.length === 0 && pending.length === 0 ? 'No messages yet. Say hello!' : 'This is the start of the chat.'}</span>
          )}
          {props.loadError && (
            <div style={errorStyle}>
              Could not load the chat: {props.loadError}{' '}
              <button type="button" style={smallButtonStyle} onClick={props.onRetryLoad}>
                Try again
              </button>
            </div>
          )}
        </div>
        {rows.map((row) =>
          row.kind === 'blocked' ? (
            <div key={row.key} style={{ ...rowStyle, ...noteStyle }} data-testid="chat-blocked">
              {blockedRowText(row.count, row.people)}
            </div>
          ) : (
            <MessageRow
              key={row.message.id}
              message={row.message}
              selfId={selfId}
              canDeleteAll={canDeleteAll}
              nameOf={nameOf}
              onDelete={onDelete}
              onAuthor={onAuthor}
            />
          ),
        )}
        {pending.map((p) => (
          <PendingRow key={p.clientMsgId} item={p} selfId={selfId} selfName={selfName} nameOf={nameOf} onRetry={onRetry} onDiscard={onDiscard} />
        ))}
      </div>
      {showJump && (
        <button
          type="button"
          onClick={jump}
          style={{ ...smallButtonStyle, position: 'absolute', right: 16, bottom: 8, boxShadow: '0 2px 8px rgba(20,24,32,0.2)' }}
        >
          {props.unread > 0 ? (
            <>
              <span style={badgeStyle}>{unreadBadge(props.unread)}</span> new, jump to the latest
            </>
          ) : (
            'Jump to the latest'
          )}
        </button>
      )}
    </div>
  )
}

interface MessageRowProps {
  message: ChatMessage
  selfId: string
  canDeleteAll: boolean
  nameOf(userId: string): string | undefined
  onDelete(id: string): void
  onAuthor(userId: string): void
}

const MessageRow = memo(function MessageRow({ message, selfId, canDeleteAll, nameOf, onDelete, onAuthor }: MessageRowProps) {
  const [confirming, setConfirming] = useState(false)
  const deleted = message.deletedAt !== null
  const own = message.authorId === selfId
  // The server's flag: never a mention across a block, whatever tokens the body has.
  const highlighted = !deleted && !own && message.mentionsYou
  const canDelete = !deleted && (own || canDeleteAll)
  return (
    <div
      className="vo-chat-row"
      style={highlighted ? mentionRowStyle : rowStyle}
      data-testid="chat-message"
      data-id={message.id}
      data-author-id={message.authorId}
      data-pending="false"
      data-mentions-me={highlighted}
    >
      <button type="button" style={linkLikeStyle} onClick={() => onAuthor(message.authorId)}>
        {message.authorName}
      </button>
      <time style={metaStyle} dateTime={message.createdAt} title={fullTime(message.createdAt)}>
        {shortTime(message.createdAt)}
      </time>{' '}
      {deleted ? (
        <span style={noteStyle}>Message deleted</span>
      ) : (
        <MessageBody body={message.body} nameOf={nameOf} selfId={selfId} mentionsYou={highlighted} />
      )}
      {canDelete && (
        <span className={confirming ? undefined : 'vo-chat-actions'} style={{ marginLeft: 8, whiteSpace: 'nowrap' }}>
          {confirming ? (
            <>
              <span style={metaStyle}>Delete this message?</span>{' '}
              <button type="button" style={smallButtonStyle} onClick={() => onDelete(message.id)} data-testid="chat-delete-confirm">
                Delete
              </button>{' '}
              <button type="button" style={smallButtonStyle} onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              style={{ ...smallButtonStyle, padding: '0 6px', fontSize: 12 }}
              onClick={() => setConfirming(true)}
              aria-label={`Delete the message from ${message.authorName} at ${shortTime(message.createdAt)}`}
              data-testid="chat-delete"
            >
              Delete
            </button>
          )}
        </span>
      )}
    </div>
  )
})

interface PendingRowProps {
  item: PendingMessage
  selfId: string
  selfName: string
  nameOf(userId: string): string | undefined
  onRetry(clientMsgId: string): void
  onDiscard(clientMsgId: string): void
}

const PendingRow = memo(function PendingRow({ item: pending, selfId, selfName, nameOf, onRetry, onDiscard }: PendingRowProps) {
  const failed = pending.status === 'failed'
  return (
    <div
      style={{ ...rowStyle, opacity: failed ? 1 : 0.6 }}
      data-testid="chat-message"
      data-id=""
      data-client-msg-id={pending.clientMsgId}
      data-author-id={selfId}
      data-pending="true"
      data-failed={failed}
    >
      <strong>{selfName}</strong>
      <span style={metaStyle}>{failed ? 'Not sent' : 'Sending…'}</span> <MessageBody body={pending.body} nameOf={nameOf} selfId={selfId} />
      {failed && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
          <span style={errorStyle}>{pending.error}</span>
          <button type="button" style={smallButtonStyle} onClick={() => onRetry(pending.clientMsgId)} data-testid="chat-retry">
            Retry
          </button>
          <button type="button" style={smallButtonStyle} onClick={() => onDiscard(pending.clientMsgId)}>
            Discard
          </button>
        </div>
      )}
    </div>
  )
})
