import { EVERYONE_TOKEN, mentionToken } from '@vo/shared'

export interface MentionCandidate {
  // A user id, or EVERYONE_ID.
  id: string
  label: string
}

export const EVERYONE_ID = '<everyone>'
export const EVERYONE_CANDIDATE: MentionCandidate = { id: EVERYONE_ID, label: 'everyone' }

export const tokenOf = (candidate: MentionCandidate): string =>
  candidate.id === EVERYONE_ID ? EVERYONE_TOKEN : mentionToken(candidate.id)

export interface MentionQuery {
  // Index of the '@'.
  start: number
  query: string
}

// The '@word' that ends at the caret: an '@' at the start or after a space or bracket, then no space.
export function mentionQuery(text: string, caret: number): MentionQuery | null {
  const match = /(?:^|[\s([{])@([^\s@]{0,40})$/u.exec(text.slice(0, caret))
  if (!match) return null
  const query = match[1] ?? ''
  return { start: caret - query.length - 1, query }
}

// Names that start with the query first, then names with a word that starts with it.
export function filterCandidates(candidates: readonly MentionCandidate[], query: string, limit = 8): MentionCandidate[] {
  const q = query.toLocaleLowerCase()
  const scored: Array<{ candidate: MentionCandidate; score: number }> = []
  for (const candidate of candidates) {
    const label = candidate.label.toLocaleLowerCase()
    const score = label.startsWith(q) ? 0 : label.split(/[\s._-]+/u).some((word) => word.startsWith(q)) ? 1 : -1
    if (score >= 0) scored.push({ candidate, score })
  }
  scored.sort((a, b) => a.score - b.score || a.candidate.label.localeCompare(b.candidate.label))
  return scored.slice(0, limit).map((s) => s.candidate)
}

export interface MentionPick {
  display: string
  token: string
}

// Replaces the '@query' before the caret with '@Label ' and returns what to remember for the send.
export function insertMention(
  text: string,
  query: MentionQuery,
  caret: number,
  candidate: MentionCandidate,
): { text: string; caret: number; pick: MentionPick } {
  const display = `@${candidate.label}`
  const next = `${text.slice(0, query.start)}${display} ${text.slice(caret)}`
  return { text: next, caret: query.start + display.length + 1, pick: { display, token: tokenOf(candidate) } }
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// The body to send: each remembered '@Label' that still stands as a whole word becomes its token. Everything else,
// including an '@name' typed by hand, stays plain text, so a mention always comes from the autocomplete.
export function encodeMentions(text: string, picks: readonly MentionPick[]): string {
  const tokens = new Map<string, string>()
  for (const pick of picks) if (!tokens.has(pick.display)) tokens.set(pick.display, pick.token)
  if (tokens.size === 0) return text
  const alternatives = [...tokens.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp)
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alternatives.join('|')})(?![\\p{L}\\p{N}_])`, 'gu')
  return text.replace(pattern, (display) => tokens.get(display) ?? display)
}
