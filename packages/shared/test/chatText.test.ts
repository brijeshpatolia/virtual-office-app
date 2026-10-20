import { describe, expect, it } from 'vitest'
import { EVERYONE_TOKEN, mentionToken, normalizeChatBody, parseMentions, renderSegments, withoutEveryone } from '../src/index.ts'

describe('parseMentions', () => {
  it('finds each mentioned user id once, in order, and the everyone token', () => {
    const body = `hi ${mentionToken('u2')} and <@u1> and <@u2> ${EVERYONE_TOKEN}`
    expect(parseMentions(body)).toEqual({ userIds: ['u2', 'u1'], everyone: true })
  })

  it('ignores display text and malformed tokens', () => {
    expect(parseMentions('@Bob <@> <@has space> <@a.b> <!here> <@@x>')).toEqual({ userIds: [], everyone: false })
    expect(parseMentions(`<@${'x'.repeat(65)}>`).userIds).toEqual([])
    expect(parseMentions('<@mock-user_1>').userIds).toEqual(['mock-user_1'])
  })
})

describe('renderSegments', () => {
  it('splits text, mentions, everyone and links', () => {
    expect(renderSegments('hey <@u1>, see https://example.com/a?b=1 now <!everyone>')).toEqual([
      { kind: 'text', text: 'hey ' },
      { kind: 'mention', userId: 'u1' },
      { kind: 'text', text: ', see ' },
      { kind: 'link', text: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' },
      { kind: 'text', text: ' now ' },
      { kind: 'everyone' },
    ])
  })

  it('keeps sentence punctuation and unbalanced brackets out of links', () => {
    expect(renderSegments('(see http://a.example/x).')).toEqual([
      { kind: 'text', text: '(see ' },
      { kind: 'link', text: 'http://a.example/x', href: 'http://a.example/x' },
      { kind: 'text', text: ').' },
    ])
    const wiki = 'https://en.wikipedia.org/wiki/Foo_(bar)'
    expect(renderSegments(`${wiki}!`)[0]).toEqual({ kind: 'link', text: wiki, href: wiki })
  })

  it('links only http and https, and never inside a word', () => {
    for (const body of ['javascript:alert(1)', 'ftp://a.example/x', 'data:text/html,<b>x</b>', 'xhttps://a.example', 'https://']) {
      expect(renderSegments(body).every((s) => s.kind === 'text')).toBe(true)
    }
    expect(renderSegments('HTTPS://A.Example/P')).toEqual([{ kind: 'link', text: 'HTTPS://A.Example/P', href: 'https://a.example/P' }])
  })

  it('leaves links with a user name or password as text, so the shown host is the one that opens', () => {
    for (const body of [
      'https://accounts.google.com\u2215login@evil.example/x',
      'https://accounts.google.com\u2044login@evil.example/x',
      'https://accounts.google.com@evil.example/x',
      'https://user:pass@evil.example/',
      'http://:pass@evil.example/',
    ]) {
      expect(renderSegments(`see ${body}`)).toEqual([{ kind: 'text', text: `see ${body}` }])
    }
    expect(renderSegments('https://evil.example/a@b')[0]).toEqual({ kind: 'link', text: 'https://evil.example/a@b', href: 'https://evil.example/a@b' })
  })

  it('leaves markup as text', () => {
    expect(renderSegments('<b>bold</b> <img src=x onerror=alert(1)>')).toEqual([
      { kind: 'text', text: '<b>bold</b> <img src=x onerror=alert(1)>' },
    ])
    expect(renderSegments('')).toEqual([])
  })
})

describe('normalizeChatBody', () => {
  it('trims, unifies line breaks and drops control and bidi override characters', () => {
    expect(normalizeChatBody('  a\r\nb\rc\n\td\u0000\u0007‮e⁦ ')).toBe('a\nb\nc\n\tde')
    expect(normalizeChatBody(' \n\t ')).toBe('')
    expect(normalizeChatBody('👍🏽 family 👨‍👩‍👧')).toBe('👍🏽 family 👨‍👩‍👧')
  })
})

describe('withoutEveryone', () => {
  it('turns the everyone token into plain text', () => {
    const body = withoutEveryone(`${EVERYONE_TOKEN} hi <@u1>`)
    expect(body).toBe('@everyone hi <@u1>')
    expect(parseMentions(body)).toEqual({ userIds: ['u1'], everyone: false })
  })
})
