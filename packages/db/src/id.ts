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
