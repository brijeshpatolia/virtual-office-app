import { describe, expect, it } from 'vitest'
import { ROOM_CLOSE } from '@vo/shared'
import { ApiRequestError } from '../api/http.ts'
import { leaveReason, type OfficeConnectionHandle, type OfficeLink } from '../net/officeLink.ts'
import { MATCHMAKE_AUTH_FAILED, OfficeConnection, isAccessDenied } from './officeConnection.ts'

function fakeHandle() {
  const handlers = { drop: [] as Array<() => void>, reconnect: [] as Array<() => void>, leave: [] as Array<(code: number) => void> }
  let left = 0
  const handle: OfficeConnectionHandle = {
    link: { sessionId: 's1' } as OfficeLink,
    onDrop: (h) => (handlers.drop.push(h), () => undefined),
    onReconnect: (h) => (handlers.reconnect.push(h), () => undefined),
    onLeave: (h) => (handlers.leave.push(h), () => undefined),
    leave: async () => {
      left += 1
    },
  }
  return { handle, handlers, leftCount: () => left }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const matchMakeError = (code: number) => Object.assign(new Error('unauthorized'), { name: 'MatchMakeError', code })

describe('leaveReason', () => {
  it('maps close codes', () => {
    expect(leaveReason(4000)).toBe('left')
    expect(leaveReason(ROOM_CLOSE.replaced)).toBe('replaced')
    expect(leaveReason(ROOM_CLOSE.removed)).toBe('removed')
    expect(leaveReason(ROOM_CLOSE.roleChanged)).toBe('role_changed')
    expect(leaveReason(4003)).toBe('lost')
    expect(leaveReason(1006)).toBe('lost')
  })
})

describe('isAccessDenied', () => {
  it('recognises an onAuth rejection and token route refusals', () => {
    expect(isAccessDenied(matchMakeError(MATCHMAKE_AUTH_FAILED))).toBe(true)
    expect(isAccessDenied(matchMakeError(523))).toBe(false)
    expect(isAccessDenied(new ApiRequestError(404, 'not_found', 'x'))).toBe(true)
    expect(isAccessDenied(new ApiRequestError(401, 'unauthorized', 'x'))).toBe(false)
    expect(isAccessDenied(new ApiRequestError(0, 'network', 'x'))).toBe(false)
  })
})

describe('OfficeConnection', () => {
  it('joins with a token and follows drop, reconnect and a replacing tab', async () => {
    const fake = fakeHandle()
    const tokens: string[] = []
    const connection = new OfficeConnection('o1', async () => 'tok', async (officeId, token) => {
      tokens.push(`${officeId}:${token}`)
      return fake.handle
    })
    connection.connect()
    expect(connection.getState().kind).toBe('connecting')
    await tick()
    expect(tokens).toEqual(['o1:tok'])
    expect(connection.getState()).toMatchObject({ kind: 'connected', reconnecting: false })
    fake.handlers.drop.forEach((h) => h())
    expect(connection.getState()).toMatchObject({ kind: 'connected', reconnecting: true })
    fake.handlers.reconnect.forEach((h) => h())
    expect(connection.getState()).toMatchObject({ kind: 'connected', reconnecting: false })
    fake.handlers.leave.forEach((h) => h(ROOM_CLOSE.replaced))
    expect(connection.getState()).toMatchObject({ kind: 'closed', reason: 'replaced' })
  })

  it('reports a refused join as denied and other failures as errors', async () => {
    const denied = new OfficeConnection('o1', async () => 'tok', async () => {
      throw matchMakeError(MATCHMAKE_AUTH_FAILED)
    })
    denied.connect()
    await tick()
    expect(denied.getState()).toMatchObject({ kind: 'closed', reason: 'denied' })

    const failed = new OfficeConnection('o1', async () => {
      throw new ApiRequestError(0, 'network', 'down')
    }, async () => fakeHandle().handle)
    failed.connect()
    await tick()
    expect(failed.getState()).toMatchObject({ kind: 'closed', reason: 'error' })

    // The token route answers 401 once the session is gone (signed out elsewhere, expired).
    const signedOut = new OfficeConnection('o1', async () => {
      throw new ApiRequestError(401, 'unauthorized', 'Please sign in.')
    }, async () => fakeHandle().handle)
    signedOut.connect()
    await tick()
    expect(signedOut.getState()).toMatchObject({ kind: 'closed', reason: 'signed_out' })
  })

  it('leaves a room that finishes joining after disconnect()', async () => {
    const fake = fakeHandle()
    let release: () => void = () => undefined
    const connection = new OfficeConnection('o1', async () => 'tok', () => new Promise((resolve) => (release = () => resolve(fake.handle))))
    connection.connect()
    await tick()
    connection.disconnect()
    release()
    await tick()
    expect(fake.leftCount()).toBe(1)
    expect(connection.getState().kind).toBe('idle')
  })

  it('notifies subscribers and leaves on disconnect', async () => {
    const fake = fakeHandle()
    const connection = new OfficeConnection('o1', async () => 'tok', async () => fake.handle)
    let calls = 0
    const unsubscribe = connection.subscribe(() => calls++)
    connection.connect()
    await tick()
    connection.disconnect()
    expect(fake.leftCount()).toBe(1)
    expect(calls).toBe(3)
    unsubscribe()
  })
})
