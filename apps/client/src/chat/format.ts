import { CHAT_MAX_LENGTH, CHAT_RATE_LIMIT } from '@vo/shared'

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })
const dateTimeFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const fullFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' })

const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

// '14:05' today, 'Oct 19, 14:05' on another day.
export function shortTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  return sameDay(date, now) ? timeFormat.format(date) : dateTimeFormat.format(date)
}

export const fullTime = (iso: string): string => fullFormat.format(new Date(iso))

const dateFormat = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
export const shortDate = (iso: string): string => dateFormat.format(new Date(iso))

const SEND_REJECT_TEXT: Record<string, string> = {
  rate_limited: `Slow down: at most ${CHAT_RATE_LIMIT.messages} messages in ${CHAT_RATE_LIMIT.windowMs / 1000} seconds.`,
  too_long: `Too long: at most ${CHAT_MAX_LENGTH.toLocaleString('en')} characters.`,
  empty: 'The message is empty.',
}

export function sendRejectText(reason: string, mutedUntil: string | null): string {
  if (reason === 'muted') return mutedUntil ? `You are muted until ${shortTime(mutedUntil)}.` : 'You are muted.'
  return SEND_REJECT_TEXT[reason] ?? 'The message could not be sent.'
}

const DELETE_REJECT_TEXT: Record<string, string> = {
  not_found: 'That message is gone already.',
  not_allowed: 'You cannot delete that message.',
}

export const deleteRejectText = (reason: string | null): string =>
  (reason && DELETE_REJECT_TEXT[reason]) ?? 'The message could not be deleted.'

export const OFFLINE_TEXT = 'Not sent: no connection. It is sent again when the connection is back.'

export const NO_ANSWER_TEXT = 'No answer from the server. Retry sends it again; it never goes out twice.'
