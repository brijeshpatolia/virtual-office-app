import { describe, expect, it } from 'vitest'
import { EVERYONE_TOKEN, mentionToken } from '@vo/shared'
import { messageParts, plainText, UNKNOWN_MENTION } from './segments.ts'

const names: Record<string, string> = { 'u-ann': 'Ann', 'u-me': 'Me' }
const nameOf = (userId: string): string | undefined => names[userId]

describe('messageParts', () => {
  it('maps the shared segments to text, links and named mentions', () => {
    const body = `${mentionToken('u-ann')} see https://example.com/a?b=1. ${mentionToken('u-me')} ${mentionToken('u-gone')} ${EVERYONE_TOKEN}`
    expect(messageParts(body, nameOf, 'u-me')).toEqual([
      { kind: 'mention', label: '@Ann', userId: 'u-ann', self: false },
      { kind: 'text', text: ' see ' },
      { kind: 'link', text: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' },
      { kind: 'text', text: '. ' },
      { kind: 'mention', label: '@Me', userId: 'u-me', self: true },
      { kind: 'text', text: ' ' },
      { kind: 'mention', label: UNKNOWN_MENTION, userId: 'u-gone', self: false },
      { kind: 'text', text: ' ' },
      { kind: 'mention', label: '@everyone', userId: null, self: true },
    ])
  })

  it('keeps markup and other schemes as plain text', () => {
    expect(messageParts('<b>hi</b> javascript:alert(1) <img src=x onerror=alert(1)>', nameOf, 'u-me')).toEqual([
      { kind: 'text', text: '<b>hi</b> javascript:alert(1) <img src=x onerror=alert(1)>' },
    ])
  })
})

describe('plainText', () => {
  it('is one line with names for the collapsed bar and notifications', () => {
    expect(plainText(`${mentionToken('u-ann')} lunch?\nat 12`, nameOf)).toBe('@Ann lunch? at 12')
  })
})
