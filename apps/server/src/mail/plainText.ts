// Text that users chose (their name, a company name) for the subject or body of a mail: one line, without links,
// at most `max` characters. `fallback` when nothing is left.
export function plainMailText(value: string, fallback: string, max = 60): string {
  const text = value
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\S*(?::\/\/|www\.)\S*/giu, ' ')
    .replace(/\S+\.\S+\/\S*/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  if (text === '') return fallback
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}
