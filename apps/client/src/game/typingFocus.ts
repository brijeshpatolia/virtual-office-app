const FIELD_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA'])

// An element that takes the arrow keys and letters itself: a form field, editable text, or an element marked
// data-own-keys (the chat's scrollable message list).
export function isTypingElement(target: unknown): boolean {
  if (typeof target !== 'object' || target === null) return false
  const element = target as { tagName?: unknown; isContentEditable?: unknown; dataset?: { ownKeys?: unknown } }
  return (
    element.isContentEditable === true ||
    element.dataset?.ownKeys !== undefined ||
    (typeof element.tagName === 'string' && FIELD_TAGS.has(element.tagName))
  )
}

const PAGE_TAGS = new Set(['BODY', 'HTML'])

// A click on the map gives the keyboard back to it. Phaser prevents the default of a mousedown on the canvas, so
// the browser would leave the focus where it was: in the chat input (the arrow keys would move its caret, not the
// avatar) or on a button (Enter would press it instead of opening the chat). So whatever has the focus loses it.
export function leaveFocusedElement(doc: { activeElement: unknown } = document): void {
  const active = doc.activeElement as { tagName?: unknown; blur?: () => void } | null
  if (active === null || typeof active !== 'object') return
  if (typeof active.tagName === 'string' && PAGE_TAGS.has(active.tagName)) return
  active.blur?.()
}

// Calls onChange(true) when focus moves into such an element and onChange(false) when it leaves it (also once now).
// Phaser listens to the keyboard on window, so without this a held arrow key walks while it changes a select.
export function watchTyping(onChange: (typing: boolean) => void): () => void {
  let typing = isTypingElement(document.activeElement)
  onChange(typing)
  const set = (next: boolean): void => {
    if (next === typing) return
    typing = next
    onChange(next)
  }
  const onFocusIn = (event: FocusEvent): void => set(isTypingElement(event.target))
  const onFocusOut = (event: FocusEvent): void => set(isTypingElement(event.relatedTarget))
  document.addEventListener('focusin', onFocusIn)
  document.addEventListener('focusout', onFocusOut)
  return () => {
    document.removeEventListener('focusin', onFocusIn)
    document.removeEventListener('focusout', onFocusOut)
  }
}

// The parts of Phaser's KeyboardPlugin that the hand-off uses.
export interface SceneKeyboard {
  enabled: boolean
  resetKeys(): unknown
  disableGlobalCapture(): unknown
  enableGlobalCapture(): unknown
}

// Typing: the scene stops reading keys (held ones are released) and stops preventing the browser's default for
// captured keys, so the field gets every key and the avatar none. Back on the map, both come back.
export function handOffKeyboard(keyboard: SceneKeyboard, typing: boolean): void {
  keyboard.enabled = !typing
  if (typing) {
    keyboard.resetKeys()
    keyboard.disableGlobalCapture()
  } else {
    keyboard.enableGlobalCapture()
  }
}
