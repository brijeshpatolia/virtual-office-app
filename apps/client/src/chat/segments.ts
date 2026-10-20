import { EVERYONE_TEXT, renderSegments } from '@vo/shared'

export type MessagePart =
  | { kind: 'text'; text: string }
  | { kind: 'link'; text: string; href: string }
  // userId null: @everyone. self: it mentions the viewer.
  | { kind: 'mention'; label: string; userId: string | null; self: boolean }

export const UNKNOWN_MENTION = '@unknown'

// What a message body shows, from the shared renderSegments: never HTML.
export function messageParts(body: string, nameOf: (userId: string) => string | undefined, selfId: string): MessagePart[] {
  return renderSegments(body).map((segment): MessagePart => {
    switch (segment.kind) {
      case 'text':
        return segment
      case 'link':
        return segment
      case 'everyone':
        return { kind: 'mention', label: EVERYONE_TEXT, userId: null, self: true }
      case 'mention': {
        const name = nameOf(segment.userId)
        return { kind: 'mention', label: name ? `@${name}` : UNKNOWN_MENTION, userId: segment.userId, self: segment.userId === selfId }
      }
    }
  })
}

// One line of plain text (collapsed bar, notifications).
export function plainText(body: string, nameOf: (userId: string) => string | undefined): string {
  return messageParts(body, nameOf, '')
    .map((part) => (part.kind === 'mention' ? part.label : part.text))
    .join('')
    .replace(/\s+/gu, ' ')
    .trim()
}
