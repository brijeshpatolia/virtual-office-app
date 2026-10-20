import { describe, expect, it } from 'vitest'
import { requestError, withoutAuthToken } from './colyseusLink.ts'
import { isRequestTimeout } from './officeLink.ts'

describe('withoutAuthToken', () => {
  it('keeps the realtime token out of the WebSocket URL', () => {
    const url = new URL('ws://localhost:8000/colyseus/proc/room?sessionId=abc&_authToken=eyJhbGciOi.payload.sig')
    expect(withoutAuthToken(url)).toBe('ws://localhost:8000/colyseus/proc/room?sessionId=abc')
    expect(withoutAuthToken(new URL('http://localhost:8000/colyseus/matchmake'))).toBe('http://localhost:8000/colyseus/matchmake')
  })
})

describe('requestError', () => {
  it('tells a request that timed out on an open connection apart from one that never got through', () => {
    const timeout = new Error('request "chat:send" timed out after 8000ms.')
    expect(isRequestTimeout(requestError(timeout, true))).toBe(true)
    expect(requestError(timeout, false)).toBe(timeout)
    const closed = new Error('connection closed before a response was received.')
    expect(requestError(closed, true)).toBe(closed)
    const rejected = Object.assign(new Error('timed out'), { name: 'rejected', reason: 'rate_limited' })
    expect(requestError(rejected, true)).toBe(rejected)
  })
})
