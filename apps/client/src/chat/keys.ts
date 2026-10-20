// Keyboard hand-off between the map and the chat. While a form field has the focus the scene ignores the keyboard
// (game/typingFocus.ts), so nothing typed into the chat reaches the avatar.

export interface KeyInput {
  key: string
  shiftKey: boolean
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
  // An IME composition is under way: Enter confirms it, it does not send.
  isComposing: boolean
}

const MAP_TAGS = new Set(['BODY', 'HTML', 'CANVAS'])

// The focus is on the map (nothing, or the game canvas), not on a button, link or field.
export function isMapTarget(target: unknown): boolean {
  if (typeof target !== 'object' || target === null) return true
  const tagName = (target as { tagName?: unknown }).tagName
  return typeof tagName === 'string' && MAP_TAGS.has(tagName)
}

const plain = (e: KeyInput): boolean => !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && !e.isComposing

// Enter on the map opens the chat and focuses its input.
export function focusesChat(e: KeyInput, target: unknown): boolean {
  return e.key === 'Enter' && plain(e) && isMapTarget(target)
}

export type ChatInputAction = 'send' | 'blur' | 'close-suggestions' | 'next' | 'previous' | 'pick' | null

// Keys in the chat input. null: the textarea does its default (Shift+Enter is a new line).
export function chatInputAction(e: KeyInput, suggestionsOpen: boolean): ChatInputAction {
  if (e.isComposing) return null
  if (suggestionsOpen) {
    if (e.key === 'ArrowDown') return 'next'
    if (e.key === 'ArrowUp') return 'previous'
    if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) return 'pick'
    if (e.key === 'Escape') return 'close-suggestions'
  }
  if (e.key === 'Escape') return 'blur'
  if (e.key === 'Enter' && plain(e)) return 'send'
  return null
}
