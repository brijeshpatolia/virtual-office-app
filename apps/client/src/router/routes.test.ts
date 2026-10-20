import { describe, expect, it } from 'vitest'
import { CLIENT_ROUTES } from '@vo/shared'
import { DEV_OFFICE_PATH, loginPath, matchRoute, safeNext } from './routes.ts'

describe('matchRoute', () => {
  it('matches every client page', () => {
    expect(matchRoute('/')).toEqual({ name: 'home' })
    expect(matchRoute('/login')).toEqual({ name: 'login', next: '/' })
    expect(matchRoute('/onboarding/')).toEqual({ name: 'onboarding' })
    expect(matchRoute('/office/off_123')).toEqual({ name: 'office', officeId: 'off_123' })
    expect(matchRoute('/invite/abc-DEF_12')).toEqual({ name: 'invite', token: 'abc-DEF_12' })
    expect(matchRoute('/accept-invitation/inv1')).toEqual({ name: 'acceptInvitation', invitationId: 'inv1' })
  })

  it('round-trips the paths that the server links to', () => {
    expect(matchRoute(CLIENT_ROUTES.office('a b/c'))).toEqual({ name: 'office', officeId: 'a b/c' })
    expect(matchRoute(CLIENT_ROUTES.invite('tok'))).toEqual({ name: 'invite', token: 'tok' })
    expect(matchRoute(CLIENT_ROUTES.acceptInvitation('x%y'))).toEqual({ name: 'acceptInvitation', invitationId: 'x%y' })
  })

  it('reads a safe next target on /login', () => {
    expect(matchRoute('/login', '?next=%2Finvite%2Ftok')).toEqual({ name: 'login', next: '/invite/tok' })
    expect(matchRoute('/login', '?next=https%3A%2F%2Fevil.example')).toEqual({ name: 'login', next: '/' })
  })

  it('rejects unknown paths, empty and malformed params and extra segments', () => {
    expect(matchRoute('/nope')).toEqual({ name: 'notFound' })
    expect(matchRoute('/office/')).toEqual({ name: 'notFound' })
    expect(matchRoute('/office/%E0%A4%A')).toEqual({ name: 'notFound' })
    expect(matchRoute('/office/a/b')).toEqual({ name: 'notFound' })
    expect(matchRoute('/o/abc')).toEqual({ name: 'notFound' })
  })

  it('serves the mock office only in dev', () => {
    expect(matchRoute(DEV_OFFICE_PATH)).toEqual({ name: 'notFound' })
    expect(matchRoute(DEV_OFFICE_PATH, '', { dev: true })).toEqual({ name: 'devOffice' })
  })
})

describe('safeNext', () => {
  it('keeps paths on this site with their query', () => {
    expect(safeNext('/office/a?debug=1')).toBe('/office/a?debug=1')
    expect(safeNext('/invite/tok')).toBe('/invite/tok')
  })

  it('sends everything else home', () => {
    for (const bad of [null, undefined, '', 'office', '//evil.example', '/\\evil.example', 'https://evil.example', '/login', '/a\nb', 'javascript:alert(1)']) {
      expect(safeNext(bad)).toBe('/')
    }
  })
})

describe('loginPath', () => {
  it('adds next only when it leads somewhere', () => {
    expect(loginPath('/')).toBe('/login')
    expect(loginPath('/invite/tok')).toBe('/login?next=%2Finvite%2Ftok')
    expect(loginPath('//evil.example')).toBe('/login')
  })
})
