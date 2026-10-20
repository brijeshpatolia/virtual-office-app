import { describe, expect, it } from 'vitest'
import { handOffKeyboard, isTypingElement, leaveTypingElement, type SceneKeyboard } from './typingFocus.ts'

describe('isTypingElement', () => {
  it('counts form fields and editable text, not buttons or the canvas', () => {
    for (const tagName of ['INPUT', 'SELECT', 'TEXTAREA']) expect(isTypingElement({ tagName, isContentEditable: false })).toBe(true)
    expect(isTypingElement({ tagName: 'DIV', isContentEditable: true })).toBe(true)
    for (const tagName of ['BUTTON', 'CANVAS', 'BODY', 'A']) expect(isTypingElement({ tagName, isContentEditable: false })).toBe(false)
    expect(isTypingElement(null)).toBe(false)
    expect(isTypingElement(undefined)).toBe(false)
    // The chat's scrollable message list takes the arrow keys (data-own-keys).
    expect(isTypingElement({ tagName: 'DIV', isContentEditable: false, dataset: { ownKeys: '' } })).toBe(true)
    expect(isTypingElement({ tagName: 'DIV', isContentEditable: false, dataset: {} })).toBe(false)
  })
})

describe('handOffKeyboard', () => {
  it('turns the scene keyboard off and releases held keys while typing, and back on afterwards', () => {
    const calls: string[] = []
    const keyboard: SceneKeyboard = {
      enabled: true,
      resetKeys: () => calls.push('reset'),
      disableGlobalCapture: () => calls.push('capture off'),
      enableGlobalCapture: () => calls.push('capture on'),
    }
    handOffKeyboard(keyboard, true)
    expect(keyboard.enabled).toBe(false)
    expect(calls).toEqual(['reset', 'capture off'])
    handOffKeyboard(keyboard, false)
    expect(keyboard.enabled).toBe(true)
    expect(calls).toEqual(['reset', 'capture off', 'capture on'])
  })
})

describe('leaveTypingElement', () => {
  it('blurs a focused field (a click on the map), and leaves buttons and the page alone', () => {
    const blurred: string[] = []
    const element = (tagName: string) => ({ tagName, isContentEditable: false, blur: () => blurred.push(tagName) })
    leaveTypingElement({ activeElement: element('TEXTAREA') })
    leaveTypingElement({ activeElement: element('BUTTON') })
    leaveTypingElement({ activeElement: element('BODY') })
    leaveTypingElement({ activeElement: null })
    expect(blurred).toEqual(['TEXTAREA'])
  })
})
