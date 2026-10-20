import { describe, expect, it } from 'vitest'
import { EVERYONE_TOKEN, mentionToken, parseMentions } from '@vo/shared'
import { encodeMentions, EVERYONE_CANDIDATE, filterCandidates, insertMention, mentionQuery, shiftPicks, withDetails } from './mentions.ts'

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
    expect(inserted.pick).toEqual({ start: 3, display: '@Ann Lee', token: mentionToken('u-ann') })
    const body = encodeMentions(inserted.text, [inserted.pick])
    expect(body).toBe(`hi ${mentionToken('u-ann')}  see you`)
    expect(parseMentions(body).userIds).toEqual(['u-ann'])
  })

  it('leaves hand-typed names, partial words and moved text as text', () => {
    const pick = { start: 0, display: '@Ann', token: mentionToken('u-ann') }
    expect(encodeMentions('@Ann and @Ann', [pick])).toBe(`${mentionToken('u-ann')} and @Ann`)
    expect(encodeMentions('@Anna', [pick])).toBe('@Anna')
    expect(encodeMentions('x@Ann', [{ ...pick, start: 1 }])).toBe('x@Ann')
    expect(encodeMentions('@Bob hi', [pick])).toBe('@Bob hi')
    expect(encodeMentions('@everyone lunch', [{ start: 0, display: '@everyone', token: EVERYONE_TOKEN }])).toBe(`${EVERYONE_TOKEN} lunch`)
    expect(encodeMentions('ping @a.b+c (x)', [{ start: 5, display: '@a.b+c (x)', token: mentionToken('u1') }])).toBe(`ping ${mentionToken('u1')}`)
  })

  it('tells two people with the same name apart by where each was picked', () => {
    const alex1 = { id: 'alex-sales', label: 'Alex' }
    const alex2 = { id: 'alex-eng', label: 'Alex' }
    const first = insertMention('@', { start: 0, query: '' }, 1, alex1)
    const draft = `${first.text}and @`
    const second = insertMention(draft, { start: draft.length - 1, query: '' }, draft.length, alex2)
    const picks = [...shiftPicks([first.pick], draft, second.text, second.caret), second.pick]
    expect(second.text).toBe('@Alex and @Alex ')
    expect(encodeMentions(second.text, picks)).toBe(`${mentionToken('alex-sales')} and ${mentionToken('alex-eng')} `)
  })

  it('drops a pick that an edit touched, so correcting a wrong pick sends the right one', () => {
    const wrong = insertMention('hi @', { start: 3, query: '' }, 4, { id: 'alex-eng', label: 'Alex' })
    // Backspace back to '@' (the caret after each edit), then pick the other Alex.
    let text = wrong.text
    let picks = [wrong.pick]
    while (text !== 'hi @') {
      const next = text.slice(0, -1)
      picks = shiftPicks(picks, text, next, next.length)
      text = next
    }
    expect(picks).toEqual([])
    const right = insertMention(text, { start: 3, query: '' }, 4, { id: 'alex-sales', label: 'Alex' })
    picks = [...shiftPicks(picks, text, right.text, right.caret), right.pick]
    expect(encodeMentions(right.text, picks)).toBe(`hi ${mentionToken('alex-sales')} `)
  })

  it('moves picks with the text typed or deleted before them, and keeps the ones before an edit', () => {
    const pick = { start: 3, display: '@Bob', token: mentionToken('u-bob') }
    expect(shiftPicks([pick], 'hi @Bob ok', 'oh hi @Bob ok', 3)).toEqual([{ ...pick, start: 6 }])
    expect(shiftPicks([pick], 'hi @Bob ok', 'hi @Bob okay', 12)).toEqual([pick])
    expect(shiftPicks([pick], 'hi @Bob ok', 'hi @Bb ok', 5)).toEqual([])
    // Deleting the first of two equal mentions keeps the second (the caret tells which one went).
    const two = [
      { start: 0, display: '@Alex', token: mentionToken('a1') },
      { start: 6, display: '@Alex', token: mentionToken('a2') },
    ]
    const left = shiftPicks(two, '@Alex @Alex ', '@Alex ', 0)
    expect(left).toEqual([{ start: 0, display: '@Alex', token: mentionToken('a2') }])
    expect(shiftPicks(two, '@Alex @Alex ', '', 0)).toEqual([])
  })

  it('adds a detail to names that more than one person has', () => {
    const list = withDetails([{ id: 'a1', label: 'Alex' }, { id: 'a2', label: 'alex' }, { id: 'b', label: 'Bob' }], (c) => `#${c.id}`)
    expect(list.map((c) => c.detail)).toEqual(['#a1', '#a2', undefined])
  })
})
