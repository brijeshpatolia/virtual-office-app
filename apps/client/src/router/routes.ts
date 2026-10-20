import { CLIENT_ROUTES } from '@vo/shared'

// The client pages. Paths come from CLIENT_ROUTES, because the server links to them (invite links, emails).
export type Route =
  | { name: 'home' }
  | { name: 'login'; next: string }
  | { name: 'onboarding' }
  | { name: 'office'; officeId: string }
  | { name: 'invite'; token: string }
  | { name: 'acceptInvitation'; invitationId: string }
  | { name: 'devOffice' }
  | { name: 'notFound' }

export const DEV_OFFICE_PATH = '/dev/office'

// '/office/' from CLIENT_ROUTES.office, and so on.
const prefixOf = (build: (param: string) => string): string => build('\u0000').replace('%00', '')
const PARAM_ROUTES = [
  { prefix: prefixOf(CLIENT_ROUTES.office), route: (officeId: string): Route => ({ name: 'office', officeId }) },
  { prefix: prefixOf(CLIENT_ROUTES.invite), route: (token: string): Route => ({ name: 'invite', token }) },
  {
    prefix: prefixOf(CLIENT_ROUTES.acceptInvitation),
    route: (invitationId: string): Route => ({ name: 'acceptInvitation', invitationId }),
  },
]

export interface MatchOptions {
  // Dev builds also serve DEV_OFFICE_PATH (the office with a mock server).
  dev?: boolean
}

export function matchRoute(pathname: string, search = '', options: MatchOptions = {}): Route {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  if (path === '/' || path === '') return { name: 'home' }
  if (path === CLIENT_ROUTES.login) return { name: 'login', next: safeNext(new URLSearchParams(search).get('next')) }
  if (path === CLIENT_ROUTES.onboarding) return { name: 'onboarding' }
  if (options.dev && path === DEV_OFFICE_PATH) return { name: 'devOffice' }
  for (const { prefix, route } of PARAM_ROUTES) {
    if (!path.startsWith(prefix)) continue
    const param = decodeParam(path.slice(prefix.length))
    return param === null ? { name: 'notFound' } : route(param)
  }
  return { name: 'notFound' }
}

function decodeParam(raw: string): string | null {
  if (raw === '' || raw.includes('/')) return null
  try {
    return decodeURIComponent(raw)
  } catch {
    return null
  }
}

const BASE = 'http://client.invalid'

// Where to go after sign-in. Only a path on this site counts; anything else (other origins, "//host",
// backslash tricks, control characters, the login page itself) goes home.
export function safeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/'
  if ([...raw].some(isUnsafeChar)) return '/'
  const url = new URL(raw, BASE)
  if (url.origin !== BASE || url.pathname === CLIENT_ROUTES.login) return '/'
  return `${url.pathname}${url.search}`
}

function isUnsafeChar(char: string): boolean {
  const code = char.charCodeAt(0)
  return char === '\\' || code < 0x20 || code === 0x7f
}

export function loginPath(next: string): string {
  const target = safeNext(next)
  return target === '/' ? CLIENT_ROUTES.login : `${CLIENT_ROUTES.login}?next=${encodeURIComponent(target)}`
}
