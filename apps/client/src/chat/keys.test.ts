import { describe, expect, it } from 'vitest'
import { chatInputAction, focusesChat, isMapTarget, type KeyInput } from './keys.ts'

const key = (k: string, fields: Partial<KeyInput> = {}): KeyInput => ({
  key: k,
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  isComposing: false,
  ...fields,
})
const el = (tagName: string) => ({ tagName })

describe('focusesChat', () => {
  it('opens the chat on Enter from the map only', () => {
    expect(focusesChat(key('Enter'), el('BODY'))).toBe(true)
    expect(focusesChat(key('Enter'), el('CANVAS'))).toBe(true)
    expect(focusesChat(key('Enter'), null)).toBe(true)
    // A focused button or link handles its own Enter; fields keep theirs.
    for (const tag of ['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'SELECT']) expect(focusesChat(key('Enter'), el(tag))).toBe(false)
    expect(focusesChat(key('Enter', { shiftKey: true }), el('BODY'))).toBe(false)
    expect(focusesChat(key('Enter', { ctrlKey: true }), el('BODY'))).toBe(false)
    expect(focusesChat(key('Enter', { isComposing: true }), el('BODY'))).toBe(false)
    expect(focusesChat(key('e'), el('BODY'))).toBe(false)
    expect(isMapTarget(el('DIV'))).toBe(false)
  })
})

describe('chatInputAction', () => {
  it('sends on Enter, keeps Shift+Enter as a new line and goes back to the map on Esc', () => {
    expect(chatInputAction(key('Enter'), false)).toBe('send')
    expect(chatInputAction(key('Enter', { shiftKey: true }), false)).toBeNull()
    expect(chatInputAction(key('Escape'), false)).toBe('blur')
    expect(chatInputAction(key('Enter', { isComposing: true }), false)).toBeNull()
    // Movement keys are plain typing.
    for (const k of ['w', 'a', 's', 'd', 'e', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) expect(chatInputAction(key(k), false)).toBeNull()
  })

  it('drives the mention list while it is open', () => {
    expect(chatInputAction(key('ArrowDown'), true)).toBe('next')
    expect(chatInputAction(key('ArrowUp'), true)).toBe('previous')
    expect(chatInputAction(key('Enter'), true)).toBe('pick')
    expect(chatInputAction(key('Tab'), true)).toBe('pick')
    expect(chatInputAction(key('Escape'), true)).toBe('close-suggestions')
    expect(chatInputAction(key('Tab', { shiftKey: true }), true)).toBeNull()
  })
})
