import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { CHAT_MAX_LENGTH } from '@vo/shared'
import { composerStyle, errorStyle, metaStyle, sendButtonStyle, suggestionsStyle, suggestionStyle, textareaStyle } from './chatStyles.ts'
import { chatInputAction } from './keys.ts'
import { encodeMentions, filterCandidates, insertMention, mentionQuery, type MentionCandidate, type MentionPick } from './mentions.ts'

const COUNTER_FROM = CHAT_MAX_LENGTH - 200

export interface ChatComposerProps {
  candidates: readonly MentionCandidate[]
  // Asks for the focus each time it changes (Enter on the map).
  focusRequest: number
  // The body with mention tokens; false keeps the draft (nothing sent).
  onSend(body: string): boolean
}

// The chat input: Enter sends, Shift+Enter is a new line, Esc goes back to the map. '@' opens the mention list.
export function ChatComposer({ candidates, focusRequest, onSend }: ChatComposerProps) {
  const input = useRef<HTMLTextAreaElement>(null)
  const [text, setText] = useState('')
  const [caret, setCaret] = useState(0)
  const [picks, setPicks] = useState<MentionPick[]>([])
  const [active, setActive] = useState(0)
  // The '@' whose list was closed with Esc.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null)
  const nextCaret = useRef<number | null>(null)

  const query = mentionQuery(text, caret)
  const suggestions = query && query.start !== dismissedAt ? filterCandidates(candidates, query.query) : []
  const open = suggestions.length > 0
  const activeIndex = Math.min(active, Math.max(suggestions.length - 1, 0))
  const body = encodeMentions(text, picks)
  const tooLong = body.length > CHAT_MAX_LENGTH

  useEffect(() => {
    if (focusRequest > 0) input.current?.focus()
  }, [focusRequest])

  // Grows with the text up to its max height; puts the caret after an inserted mention.
  useLayoutEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
    if (nextCaret.current !== null) {
      el.setSelectionRange(nextCaret.current, nextCaret.current)
      nextCaret.current = null
    }
  }, [text])

  const onChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    setText(event.target.value)
    setCaret(event.target.selectionStart)
    setActive(0)
    if (event.target.value === '') setPicks([])
  }

  const pick = (candidate: MentionCandidate): void => {
    if (!query) return
    const inserted = insertMention(text, query, caret, candidate)
    setText(inserted.text)
    setCaret(inserted.caret)
    setPicks((list) => [...list, inserted.pick])
    nextCaret.current = inserted.caret
    setActive(0)
  }

  const send = (): void => {
    if (tooLong || !onSend(body)) return
    setText('')
    setCaret(0)
    setPicks([])
    setDismissedAt(null)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    const action = chatInputAction(event.nativeEvent, open)
    if (action === null) return
    event.preventDefault()
    // The page's Escape handlers (panels) must not also act on it.
    event.stopPropagation()
    switch (action) {
      case 'send':
        send()
        return
      case 'blur':
        event.currentTarget.blur()
        return
      case 'close-suggestions':
        setDismissedAt(query?.start ?? null)
        return
      case 'next':
        setActive((activeIndex + 1) % suggestions.length)
        return
      case 'previous':
        setActive((activeIndex - 1 + suggestions.length) % suggestions.length)
        return
      case 'pick': {
        const candidate = suggestions[activeIndex]
        if (candidate) pick(candidate)
        return
      }
    }
  }

  const optionId = (i: number): string => `chat-mention-${i}`

  return (
    <div style={composerStyle}>
      {open && (
        <ul id="chat-mentions" role="listbox" aria-label="Mention someone" style={suggestionsStyle} data-testid="chat-mentions">
          {suggestions.map((candidate, i) => (
            <li
              key={candidate.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === activeIndex}
              style={suggestionStyle(i === activeIndex)}
              // Keep the focus in the input.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(candidate)}
              data-testid="chat-mention-option"
            >
              @{candidate.label}
            </li>
          ))}
        </ul>
      )}
      <label htmlFor="chat-input" className="vo-sr-only">
        Message everyone in the office
      </label>
      <textarea
        id="chat-input"
        ref={input}
        rows={1}
        value={text}
        maxLength={CHAT_MAX_LENGTH}
        placeholder="Message the office (Enter to send, Esc back to the map)"
        style={textareaStyle}
        onChange={onChange}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        onKeyDown={onKeyDown}
        aria-autocomplete="list"
        aria-controls={open ? 'chat-mentions' : undefined}
        aria-activedescendant={open ? optionId(activeIndex) : undefined}
        aria-describedby={tooLong ? 'chat-too-long' : undefined}
        aria-invalid={tooLong || undefined}
        data-testid="chat-input"
      />
      {body.length > COUNTER_FROM && (
        <span id="chat-too-long" style={tooLong ? errorStyle : metaStyle} aria-live="polite">
          {body.length}/{CHAT_MAX_LENGTH}
        </span>
      )}
      <button
        type="button"
        style={sendButtonStyle}
        onClick={() => {
          send()
          input.current?.focus()
        }}
        disabled={tooLong || text.trim() === ''}
        data-testid="chat-send"
      >
        Send
      </button>
    </div>
  )
}
