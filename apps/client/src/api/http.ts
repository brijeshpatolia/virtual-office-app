import { ApiErrorSchema, type ApiErrorCode } from '@vo/shared'
import { apiUrl } from './serverUrl.ts'

// Any zod schema from @vo/shared fits; the client does not import zod itself.
export interface Parser<T> {
  parse(data: unknown): T
}

export type RequestErrorCode = ApiErrorCode | 'network' | 'bad_response'

export class ApiRequestError extends Error {
  readonly status: number
  readonly code: RequestErrorCode
  // The server's short reason ('removed', 'company_limit', ...); message is the text for the UI.
  readonly reason: string | undefined

  constructor(status: number, code: RequestErrorCode, message: string, reason?: string) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = code
    this.reason = reason
  }
}

const REASON_TEXT: Record<string, string> = {
  origin: 'This request did not come from the office page.',
  membership_limit: 'This company is full.',
  company_limit: 'You already own as many companies as one person can.',
  removed: 'An owner or admin removed you from this company. Ask them for an email invitation.',
}

export function isApiError(error: unknown, code: RequestErrorCode): boolean {
  return error instanceof ApiRequestError && error.code === code
}

// A short text for the UI.
export function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.code === 'network') return 'Cannot reach the office server. Is it running?'
    return error.message
  }
  return error instanceof Error ? error.message : 'Something went wrong.'
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
}

// JSON request with the session cookie. Throws ApiRequestError for network errors, error statuses and responses
// that do not match the schema.
export async function apiRequest<T>(path: string, schema: Parser<T>, options: RequestOptions = {}): Promise<T> {
  const { method = options.body === undefined ? 'GET' : 'POST', body } = options
  let response: Response
  try {
    response = await fetch(apiUrl(path), {
      method,
      credentials: 'include',
      headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (error) {
    throw new ApiRequestError(0, 'network', error instanceof Error ? error.message : 'Network error')
  }
  const json: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const parsed = ApiErrorSchema.safeParse(json)
    if (parsed.success) {
      const { error, message } = parsed.data
      const text = message === undefined ? defaultMessage(error) : (REASON_TEXT[message] ?? message)
      throw new ApiRequestError(response.status, error, text, message)
    }
    // The Vite proxy answers 502/504 when the office server is down.
    if (response.status === 502 || response.status === 504) throw new ApiRequestError(response.status, 'network', 'Bad gateway')
    throw new ApiRequestError(response.status, 'bad_response', `Unexpected response (${response.status})`)
  }
  try {
    return schema.parse(json)
  } catch {
    throw new ApiRequestError(response.status, 'bad_response', 'Unexpected response from the server')
  }
}

function defaultMessage(code: ApiErrorCode): string {
  switch (code) {
    case 'invalid_request':
      return 'The request was not valid.'
    case 'unauthorized':
      return 'Please sign in.'
    case 'forbidden':
      return 'You are not allowed to do that.'
    case 'not_found':
      return 'Not found.'
    case 'invite_invalid':
      return 'This invite is no longer valid.'
    case 'length_required':
    case 'payload_too_large':
    case 'unsupported_media_type':
      return 'The request was too large or not JSON.'
    case 'rate_limited':
      return 'Too many requests. Try again in a minute.'
    case 'internal':
      return 'The server had a problem. Try again.'
  }
}
