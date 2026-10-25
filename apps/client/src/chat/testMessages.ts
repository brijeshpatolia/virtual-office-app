import type { ChatMessage } from '@vo/shared'

// Test fixtures (imported by tests only): uuidv7-shaped ids that sort by n, and messages with them.
export const idOf = (n: number): string => `0190f000-0000-7${n.toString(16).padStart(3, '0')}-8000-000000000000`

export const numberOf = (id: string): number => Number.parseInt(id.slice(15, 18), 16)

export function message(n: number, fields: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: idOf(n),
    clientMsgId: `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`,
    authorId: 'ann',
    authorName: 'Ann',
    body: `message ${n}`,
    createdAt: new Date(1_700_000_000_000 + n * 1000).toISOString(),
    deletedAt: null,
    mentionsYou: false,
    ...fields,
  }
}
