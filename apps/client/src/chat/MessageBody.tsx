import { messageParts } from './segments.ts'
import { mentionStyle, selfMentionStyle } from './chatStyles.ts'

// A message as text, links and mentions. React escapes every text node; nothing goes in as HTML.
export function MessageBody({ body, nameOf, selfId }: { body: string; nameOf: (userId: string) => string | undefined; selfId: string }) {
  return (
    <>
      {messageParts(body, nameOf, selfId).map((part, i) => {
        switch (part.kind) {
          case 'text':
            return <span key={i}>{part.text}</span>
          case 'link':
            return (
              <a key={i} className="vo-chat-link" href={part.href} target="_blank" rel="noopener noreferrer">
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
