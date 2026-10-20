const FIELD_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA'])

// An element that takes the arrow keys and letters itself: a form field, or editable text.
export function isTypingElement(target: unknown): boolean {
  if (typeof target !== 'object' || target === null) return false
  const element = target as { tagName?: unknown; isContentEditable?: unknown }
  return element.isContentEditable === true || (typeof element.tagName === 'string' && FIELD_TAGS.has(element.tagName))
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
