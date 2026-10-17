import { describe, expect, it } from 'vitest'
import { DEV_AUTH_SECRET, EnvError, loadEnv } from '../src/env.ts'

const PRODUCTION = {
  NODE_ENV: 'production',
  CLIENT_ORIGIN: 'https://office.example.com',
  BETTER_AUTH_URL: 'https://api.office.example.com',
  BETTER_AUTH_SECRET: 's'.repeat(40),
  DATABASE_URL: 'postgres://user:pass@db.example.com/office',
  RESEND_API_KEY: 're_live',
  EMAIL_FROM: 'Virtual Office <office@example.com>',
}

function issuesOf(source: Record<string, string | undefined>): string[] {
  try {
    loadEnv(source)
  } catch (error) {
    if (error instanceof EnvError) return error.issues
    throw error
  }
  return []
}

describe('loadEnv', () => {
  it('refuses to start without NODE_ENV, so production never falls back to the development defaults', () => {
    expect(issuesOf({ DATABASE_URL: 'postgres://db', RESEND_API_KEY: 're_live' }).join()).toMatch(/NODE_ENV/)
    expect(issuesOf({ NODE_ENV: 'staging' }).join()).toMatch(/NODE_ENV/)
  })

  it('uses the development defaults in development and tests', () => {
    const env = loadEnv({ NODE_ENV: 'development' })
    expect(env).toMatchObject({ isProduction: false, CLIENT_ORIGIN: 'http://localhost:8000', BETTER_AUTH_URL: 'http://localhost:8000' })
    expect(env.BETTER_AUTH_SECRET).toBe(DEV_AUTH_SECRET)
    expect(loadEnv({ NODE_ENV: 'test' }).PGLITE_DIR).toBe('memory://')
  })

  it('needs every production setting, CLIENT_ORIGIN included', () => {
    expect(loadEnv(PRODUCTION)).toMatchObject({ isProduction: true, CLIENT_ORIGIN: 'https://office.example.com' })
    expect(issuesOf({ ...PRODUCTION, CLIENT_ORIGIN: undefined })).toEqual(['CLIENT_ORIGIN is required'])
    expect(issuesOf({ ...PRODUCTION, BETTER_AUTH_SECRET: DEV_AUTH_SECRET })).toEqual(['BETTER_AUTH_SECRET is required'])
    expect(issuesOf({ NODE_ENV: 'production' })).toHaveLength(6)
  })
})
