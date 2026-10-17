// Placeholder avatars are drawn by code in one colour per user. The server sets PlayerState.color with this.
export const AVATAR_COLORS = [
  '#e6194b',
  '#3cb44b',
  '#4363d8',
  '#f58231',
  '#911eb4',
  '#42d4f4',
  '#f032e6',
  '#469990',
  '#9a6324',
  '#800000',
  '#808000',
  '#000075',
] as const

// FNV-1a over the UTF-16 code units: stable across processes and browsers.
export function avatarColor(userId: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? AVATAR_COLORS[0]
}
