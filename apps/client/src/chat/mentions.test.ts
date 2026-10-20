import { describe, expect, it } from 'vitest'
import { EVERYONE_TOKEN, mentionToken, parseMentions } from '@vo/shared'
import { encodeMentions, EVERYONE_CANDIDATE, filterCandidates, insertMention, mentionQuery } from './mentions.ts'

const people = [
  { id: 'u-ann', label: 'Ann Lee' },
  { id: 'u-anna', label: 'Anna' },
  { id: 'u-bob', label: 'Bob' },
  { id: 'u-dan', label: 'Dan Annis' },
  EVERYONE_CANDIDATE,
]

describe('mentionQuery', () => {
  it('finds the @word that ends at the caret', () => {
    expect(mentionQuery('hi @an', 6)).toEqual({ start: 3, query: 'an' })
    expect(mentionQuery('@', 1)).toEqual({ start: 0, query: '' })
    expect(mentionQuery('(@bo', 4)).toEqual({ start: 1, query: 'bo' })
    expect(mentionQuery('hi @an more', 6)).toEqual({ start: 3, query: 'an' })
  })

  it('ignores emails, finished words and a caret elsewhere', () => {
    expect(mentionQuery('mail ann@example.com', 20)).toBeNull()
    expect(mentionQuery('hi @ann ', 8)).toBeNull()
    expect(mentionQuery('hi @ann', 2)).toBeNull()
  })
})

describe('filterCandidates', () => {
  it('puts names that start with the query first, then word starts, and limits the list', () => {
    expect(filterCandidates(people, 'an').map((c) => c.id)).toEqual(['u-ann', 'u-anna', 'u-dan'])
    expect(filterCandidates(people, 'LEE').map((c) => c.id)).toEqual(['u-ann'])
    expect(filterCandidates(people, 'ev').map((c) => c.id)).toEqual([EVERYONE_CANDIDATE.id])
    expect(filterCandidates(people, '')).toHaveLength(5)
    expect(filterCandidates(people, '', 2)).toHaveLength(2)
    expect(filterCandidates(people, 'zz')).toEqual([])
  })
})

describe('insertMention and encodeMentions', () => {
  it('inserts the display text and sends the user id token, never the display text', () => {
    const text = 'hi @an see you'
    const inserted = insertMention(text, { start: 3, query: 'an' }, 6, people[0] ?? EVERYONE_CANDIDATE)
    expect(inserted.text).toBe('hi @Ann Lee  see you')
    expect(inserted.caret).toBe(12)
    const body = encodeMentions(inserted.text, [inserted.pick])
    expect(body).toBe(`hi ${mentionToken('u-ann')}  see you`)
    expect(parseMentions(body).userIds).toEqual(['u-ann'])
  })

  it('leaves hand-typed names, partial words and removed picks as text', () => {
    const picks = [
      { display: '@Ann', token: mentionToken('u-ann') },
      { display: '@Ann Lee', token: mentionToken('u-annlee') },
      { display: '@everyone', token: EVERYONE_TOKEN },
    ]
    expect(encodeMentions('@Ann Lee and @Ann, @Anna, mail@Ann', picks)).toBe(`${mentionToken('u-annlee')} and ${mentionToken('u-ann')}, @Anna, mail@Ann`)
    expect(encodeMentions('@everyone lunch', picks)).toBe(`${EVERYONE_TOKEN} lunch`)
    expect(encodeMentions('@Bob hi', picks)).toBe('@Bob hi')
    expect(encodeMentions('@Bob hi', [])).toBe('@Bob hi')
  })

  it('escapes names with regular expression characters', () => {
    expect(encodeMentions('ping @a.b+c (x)', [{ display: '@a.b+c (x)', token: mentionToken('u1') }])).toBe(`ping ${mentionToken('u1')}`)
    expect(encodeMentions('ping @aXb+c (x)', [{ display: '@a.b+c (x)', token: mentionToken('u1') }])).toBe('ping @aXb+c (x)')
  })
})
