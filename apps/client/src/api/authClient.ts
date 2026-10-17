import { createAuthClient } from 'better-auth/client'
import { emailOTPClient, jwtClient, organizationClient } from 'better-auth/client/plugins'
import { API } from '@vo/shared'
import { SERVER_URL } from './serverUrl.ts'

// Better Auth in the browser. The session is an httpOnly cookie; nothing is stored in localStorage.
// In dev baseURL is the page origin (Vite forwards /api/auth); P1b sets VITE_SERVER_URL for a split origin.
export const authClient = createAuthClient({
  ...(SERVER_URL ? { baseURL: SERVER_URL, fetchOptions: { credentials: 'include' as const } } : {}),
  basePath: API.auth,
  plugins: [organizationClient(), emailOTPClient(), jwtClient()],
})

export class AuthError extends Error {
  readonly code: string | undefined
  readonly status: number

  constructor(message: string, code: string | undefined, status: number) {
    super(message)
    this.name = 'AuthError'
    this.code = code
    this.status = status
  }
}

// Better Auth answers { data, error }; turn an error into a thrown AuthError (code e.g. 'INVALID_OTP').
export async function unwrap<T>(
  result: Promise<{ data: T; error: null } | { data: null; error: { message?: string; code?: string; status: number } }>,
): Promise<T> {
  const { data, error } = await result
  if (error) throw new AuthError(error.message || `Request failed (${error.status})`, error.code, error.status)
  return data as T
}

const AUTH_ERROR_TEXT: Record<string, string> = {
  INVALID_OTP: 'That code is not right. Check the email, or send a new code.',
  OTP_EXPIRED: 'The code has expired. Send a new code.',
  TOO_MANY_ATTEMPTS: 'Too many tries. Send a new code.',
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: 'Too many tries. Send a new code.',
}

export function authErrorText(error: unknown): string | null {
  if (!(error instanceof AuthError)) return null
  if (error.status === 429) return 'Too many requests. Wait a minute and try again.'
  const code = error.code ?? ''
  return Object.hasOwn(AUTH_ERROR_TEXT, code) ? (AUTH_ERROR_TEXT[code] ?? null) : null
}
