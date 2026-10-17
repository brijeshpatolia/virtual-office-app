import { describe, expect, it } from 'vitest'
import { isTypingElement } from './typingFocus.ts'

describe('isTypingElement', () => {
  it('counts form fields and editable text, not buttons or the canvas', () => {
    for (const tagName of ['INPUT', 'SELECT', 'TEXTAREA']) expect(isTypingElement({ tagName, isContentEditable: false })).toBe(true)
    expect(isTypingElement({ tagName: 'DIV', isContentEditable: true })).toBe(true)
    for (const tagName of ['BUTTON', 'CANVAS', 'BODY', 'A']) expect(isTypingElement({ tagName, isContentEditable: false })).toBe(false)
    expect(isTypingElement(null)).toBe(false)
    expect(isTypingElement(undefined)).toBe(false)
  })
})
