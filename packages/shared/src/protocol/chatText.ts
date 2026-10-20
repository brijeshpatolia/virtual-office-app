// Chat bodies are plain text with two kinds of tokens. The server stores the body as sent (after normalizeChatBody),
// so a mention always names a user id, never a display name:
//   <@userId>     a mention of one user (the client inserts it from the autocomplete)
//   <!everyone>   a mention of everyone in the office (not for guests: the server turns it into the text '@everyone')

export const CHAT_MAX_LENGTH = 2000
export const EVERYONE_TOKEN = '<!everyone>'
export const EVERYONE_TEXT = '@everyone'

const TOKEN = /<@([A-Za-z0-9_-]{1,64})>|<!everyone>/g
const LINK = /(?<![A-Za-z0-9])https?:\/\/[^\s<>"'`]+/gi
const TRAILING = /[.,;:!?'"]+$/
const BIDI_CONTROLS = /[‪-‮⁦-⁩]/g
// Control characters other than newline and tab.
const CONTROLS = /[^\P{Cc}\n\t]/gu

export const mentionToken = (userId: string): string => `<@${userId}>`

// What the server stores for a raw chat:send body: one kind of line break, no control or bidi override characters,
// trimmed. Length checks (1 to CHAT_MAX_LENGTH UTF-16 code units) apply to the result.
export function normalizeChatBody(raw: string): string {
  return raw.replace(/\r\n?/g, '\n').replace(CONTROLS, '').replace(BIDI_CONTROLS, '').trim()
}

// A guest's body: the everyone token becomes plain text.
export function withoutEveryone(body: string): string {
  return body.replaceAll(EVERYONE_TOKEN, EVERYONE_TEXT)
}

export interface ParsedMentions {
  // Each mentioned user id once, in order of appearance.
  userIds: string[]
  everyone: boolean
}

export function parseMentions(body: string): ParsedMentions {
  const userIds = new Set<string>()
  let everyone = false
  for (const match of body.matchAll(TOKEN)) {
    if (match[1] === undefined) everyone = true
    else userIds.add(match[1])
  }
  return { userIds: [...userIds], everyone }
}

export type ChatSegment =
  | { kind: 'text'; text: string }
  // href is the parsed http(s) URL; open it with target="_blank" rel="noopener noreferrer".
  | { kind: 'link'; text: string; href: string }
  | { kind: 'mention'; userId: string }
  | { kind: 'everyone' }

// The body as segments for text-only rendering: never as HTML. Only http and https links become links.
export function renderSegments(body: string): ChatSegment[] {
  const segments: ChatSegment[] = []
  let at = 0
  for (const match of body.matchAll(TOKEN)) {
    pushText(segments, body.slice(at, match.index))
    segments.push(match[1] === undefined ? { kind: 'everyone' } : { kind: 'mention', userId: match[1] })
    at = match.index + match[0].length
  }
  pushText(segments, body.slice(at))
  return segments
}

function pushText(segments: ChatSegment[], text: string): void {
  let at = 0
  for (const match of text.matchAll(LINK)) {
    const raw = trimLink(match[0])
    const href = httpUrl(raw)
    if (href === null) continue
    appendText(segments, text.slice(at, match.index))
    segments.push({ kind: 'link', text: raw, href })
    at = match.index + raw.length
  }
  appendText(segments, text.slice(at))
}

function appendText(segments: ChatSegment[], text: string): void {
  if (text === '') return
  const last = segments.at(-1)
  if (last?.kind === 'text') last.text += text
  else segments.push({ kind: 'text', text })
}

// Sentence punctuation after a link is not part of it, nor is a closing bracket without its opening one.
function trimLink(raw: string): string {
  let link = raw.replace(TRAILING, '')
  while (link.endsWith(')') && count(link, ')') > count(link, '(')) link = link.slice(0, -1).replace(TRAILING, '')
  return link
}

const count = (text: string, char: string): number => text.split(char).length - 1

function httpUrl(text: string): string | null {
  try {
    const url = new URL(text)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '' ? url.href : null
  } catch {
    return null
  }
}
