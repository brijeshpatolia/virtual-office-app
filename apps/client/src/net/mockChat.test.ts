import { describe, expect, it } from 'vitest'
import { MessageIdSchema } from '@vo/shared'
import { mockMessageId } from './mockChat.ts'

describe('mockMessageId', () => {
  it('makes valid uuidv7 ids that sort by time, also within one millisecond', () => {
    const ids = [mockMessageId(1_760_000_000_000), mockMessageId(1_760_000_000_000), mockMessageId(1_760_000_000_001), mockMessageId(1_759_999_999_999)]
    for (const id of ids) expect(MessageIdSchema.safeParse(id).success).toBe(true)
    expect([...ids].sort()).toEqual(ids)
    expect(ids[0]?.[14]).toBe('7')
  })
})
