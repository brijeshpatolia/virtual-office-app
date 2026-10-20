const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
// The largest multiple of 62 below 256: bytes from here up would bias the result, so they are skipped.
const LIMIT = 248

// Ids for the product tables, in the same format as Better Auth's default ids: 32 random characters [A-Za-z0-9].
export function newId(length = 32): string {
  let id = ''
  while (id.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (byte < LIMIT) id += ALPHABET[byte % 62]
      if (id.length === length) break
    }
  }
  return id
}

let lastMs = 0
let counter = 0

// Chat message ids: uuidv7 (RFC 9562) with a 12-bit counter after the millisecond timestamp, so the ids made by one
// process strictly increase (as text and as Postgres uuid) even within one millisecond or when the clock goes back.
export function newMessageId(nowMs: number = Date.now()): string {
  let ms = Math.max(Math.floor(nowMs), lastMs)
  if (ms === lastMs) counter += 1
  else counter = 0
  if (counter > 0xfff) {
    ms += 1
    counter = 0
  }
  lastMs = ms
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ms % 256
    ms = Math.floor(ms / 256)
  }
  bytes[6] = 0x70 | (counter >> 8)
  bytes[7] = counter & 0xff
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f)
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// The millisecond timestamp of a newMessageId.
export function messageIdTime(id: string): number {
  return Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16)
}
