import { useMemo } from 'react'
import { messageParts } from './segments.ts'
import { mentionStyle, selfMentionStyle } from './chatStyles.ts'

interface MessageBodyProps {
  body: string
  nameOf: (userId: string) => string | undefined
  selfId: string
  // The server's mentionsYou: only then does a mention of the viewer stand out.
  mentionsYou?: boolean
}

// A message as text, links and mentions. React escapes every text node; nothing goes in as HTML. A link shows the
// address it opens as its title (punycode for a look-alike host).
export function MessageBody({ body, nameOf, selfId, mentionsYou = false }: MessageBodyProps) {
  const parts = useMemo(() => messageParts(body, nameOf, selfId, mentionsYou), [body, nameOf, selfId, mentionsYou])
  return (
    <>
      {parts.map((part, i) => {
        switch (part.kind) {
          case 'text':
            return <span key={i}>{part.text}</span>
          case 'link':
            return (
              <a key={i} className="vo-chat-link" href={part.href} title={part.href} target="_blank" rel="noopener noreferrer">
                {part.text}
              </a>
            )
          case 'mention':
            return (
              <span key={i} style={part.self ? selfMentionStyle : mentionStyle} data-mention={part.userId ?? 'everyone'}>
                {part.label}
              </span>
            )
        }
      })}
    </>
  )
}
