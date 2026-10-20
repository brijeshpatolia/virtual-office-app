import { useEffect, useRef } from 'react'

// Open overlays (profile card, People panel, status menu), the newest last. Escape closes only the newest one.
const stack: Array<{ current: () => void }> = []

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.defaultPrevented) return
  const top = stack.at(-1)
  if (!top) return
  event.preventDefault()
  top.current()
}

// While active, Escape anywhere on the page calls onEscape, unless a newer overlay is open or a field (the chat
// input) handled the key first.
export function useEscape(active: boolean, onEscape: () => void): void {
  const handler = useRef(onEscape)
  useEffect(() => {
    handler.current = onEscape
  })
  useEffect(() => {
    if (!active) return
    const entry = { current: () => handler.current() }
    stack.push(entry)
    if (stack.length === 1) document.addEventListener('keydown', onKeyDown)
    return () => {
      stack.splice(stack.indexOf(entry), 1)
      if (stack.length === 0) document.removeEventListener('keydown', onKeyDown)
    }
  }, [active])
}
