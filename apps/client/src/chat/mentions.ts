import { EVERYONE_TOKEN, mentionToken } from '@vo/shared'

export interface MentionCandidate {
  // A user id, or EVERYONE_ID.
  id: string
  label: string
  // Shown after the label when another candidate has the same one.
  detail?: string
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

// One mention picked from the list: its display text at `start` in the draft, and the token it stands for.
export interface MentionPick {
  start: number
  display: string
  token: string
}

// Replaces the '@query' before the caret with '@Label ' and returns the pick at its place.
export function insertMention(
  text: string,
  query: MentionQuery,
  caret: number,
  candidate: MentionCandidate,
): { text: string; caret: number; pick: MentionPick } {
  const display = `@${candidate.label}`
  const next = `${text.slice(0, query.start)}${display} ${text.slice(caret)}`
  return { text: next, caret: query.start + display.length + 1, pick: { start: query.start, display, token: tokenOf(candidate) } }
}

// The picks after an edit from `before` to `after` (caret: where the edit ended in `after`). A pick the edit touched
// is dropped (it is plain text from then on); the ones after it move with the text.
export function shiftPicks(picks: readonly MentionPick[], before: string, after: string, caret: number): MentionPick[] {
  if (picks.length === 0 || before === after) return [...picks]
  // The text after the caret is what stayed; the edit is [prefix, caret) in `after`.
  const maxSuffix = Math.min(after.length - caret, before.length)
  let suffix = 0
  while (suffix < maxSuffix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++
  const maxPrefix = Math.min(caret, before.length - suffix)
  let prefix = 0
  while (prefix < maxPrefix && before[prefix] === after[prefix]) prefix++
  const editedUntil = before.length - suffix
  const delta = after.length - before.length
  return picks.flatMap((pick) => {
    if (pick.start + pick.display.length <= prefix) return [pick]
    if (pick.start >= editedUntil) return [{ ...pick, start: pick.start + delta }]
    return []
  })
}

const WORD_CHAR = /[\p{L}\p{N}_]/u

// The body to send: each pick that still stands where it was put, as a whole word, becomes its token. Everything
// else, including an '@name' typed by hand or a second person with the same name, stays as typed or as picked.
export function encodeMentions(text: string, picks: readonly MentionPick[]): string {
  let body = ''
  let at = 0
  for (const pick of [...picks].sort((a, b) => a.start - b.start)) {
    const end = pick.start + pick.display.length
    const whole = !WORD_CHAR.test(text[pick.start - 1] ?? '') && !WORD_CHAR.test(text[end] ?? '')
    if (pick.start < at || text.slice(pick.start, end) !== pick.display || !whole) continue
    body += text.slice(at, pick.start) + pick.token
    at = end
  }
  return body + text.slice(at)
}

// Labels that more than one candidate shares get a detail (role, joined date) so the list tells them apart.
export function withDetails<T extends MentionCandidate>(candidates: readonly T[], detailOf: (candidate: T) => string): (T & { detail?: string })[] {
  const counts = new Map<string, number>()
  for (const c of candidates) counts.set(c.label.toLocaleLowerCase(), (counts.get(c.label.toLocaleLowerCase()) ?? 0) + 1)
  return candidates.map((c) => ((counts.get(c.label.toLocaleLowerCase()) ?? 0) > 1 ? { ...c, detail: detailOf(c) } : c))
}
