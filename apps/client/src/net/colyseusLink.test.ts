import { describe, expect, it } from 'vitest'
import { withoutAuthToken } from './colyseusLink.ts'

describe('withoutAuthToken', () => {
  it('keeps the realtime token out of the WebSocket URL', () => {
    const url = new URL('ws://localhost:8000/colyseus/proc/room?sessionId=abc&_authToken=eyJhbGciOi.payload.sig')
    expect(withoutAuthToken(url)).toBe('ws://localhost:8000/colyseus/proc/room?sessionId=abc')
    expect(withoutAuthToken(new URL('http://localhost:8000/colyseus/matchmake'))).toBe('http://localhost:8000/colyseus/matchmake')
  })
})
