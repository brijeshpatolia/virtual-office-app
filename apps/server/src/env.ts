import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const SERVER_DIR = fileURLToPath(new URL('..', import.meta.url))
const REPO_DIR = resolve(SERVER_DIR, '../..')
export const DEV_AUTH_SECRET = 'dev-only-better-auth-secret-never-use-in-production'

const origin = z.url().transform((value) => new URL(value).origin)

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65535).default(2567),
  // The browser origin of the client. Only this origin may call the API with credentials.
  CLIENT_ORIGIN: origin.default('http://localhost:8000'),
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
  // The public origin of the auth API. In dev the browser reaches it through the Vite proxy (the client origin).
  BETTER_AUTH_URL: origin.optional(),
  DATABASE_URL: z.string().min(1).optional(),
  // Local data (PGlite files, dev mail log). Relative paths start at the repository root.
  DATA_DIR: z.string().default('.data'),
  // PGlite directory, or 'memory://'. Default: DATA_DIR/pglite (tests: memory://).
  PGLITE_DIR: z.string().optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(3).optional(),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  // Relative paths start at apps/server.
  MAP_PATH: z.string().default('../client/public/assets/map/map.json'),
})

export interface Env {
  NODE_ENV: 'development' | 'test' | 'production'
  isProduction: boolean
  PORT: number
  CLIENT_ORIGIN: string
  BETTER_AUTH_SECRET: string
  BETTER_AUTH_URL: string
  // Unset: PGlite at PGLITE_DIR.
  DATABASE_URL: string | undefined
  DATA_DIR: string
  PGLITE_DIR: string
  // Development only: the mailer appends every mail here and prints it. Never used in production.
  DEV_MAIL_LOG: string
  RESEND_API_KEY: string | undefined
  EMAIL_FROM: string
  // Set only when both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set.
  google: { clientId: string; clientSecret: string } | undefined
  MAP_PATH: string
}

export class EnvError extends Error {
  readonly issues: string[]

  constructor(issues: string[]) {
    super(`Invalid environment:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`)
    this.name = 'EnvError'
    this.issues = issues
  }
}

// Reads and checks the environment. Empty strings count as unset. Throws EnvError with every problem.
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const raw = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined && value !== ''))
  const parsed = EnvSchema.safeParse(raw)
  if (!parsed.success) {
    throw new EnvError(parsed.error.issues.map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`))
  }
  const e = parsed.data
  const isProduction = e.NODE_ENV === 'production'
  const issues: string[] = []
  if (isProduction) {
    if (!e.BETTER_AUTH_SECRET || e.BETTER_AUTH_SECRET === DEV_AUTH_SECRET) issues.push('BETTER_AUTH_SECRET is required')
    if (!e.BETTER_AUTH_URL) issues.push('BETTER_AUTH_URL is required')
    if (!e.DATABASE_URL) issues.push('DATABASE_URL is required (PGlite is for development and tests)')
    if (!e.RESEND_API_KEY) issues.push('RESEND_API_KEY is required (production never logs mail)')
    if (!e.EMAIL_FROM) issues.push('EMAIL_FROM is required')
  }
  if ((e.GOOGLE_CLIENT_ID === undefined) !== (e.GOOGLE_CLIENT_SECRET === undefined)) {
    issues.push('set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither')
  }
  if (issues.length > 0) throw new EnvError(issues)

  const dataDir = isAbsolute(e.DATA_DIR) ? e.DATA_DIR : resolve(REPO_DIR, e.DATA_DIR)
  const pgliteDir = e.PGLITE_DIR ?? (e.NODE_ENV === 'test' ? 'memory://' : join(dataDir, 'pglite'))
  return {
    NODE_ENV: e.NODE_ENV,
    isProduction,
    PORT: e.PORT,
    CLIENT_ORIGIN: e.CLIENT_ORIGIN,
    BETTER_AUTH_SECRET: e.BETTER_AUTH_SECRET ?? DEV_AUTH_SECRET,
    BETTER_AUTH_URL: e.BETTER_AUTH_URL ?? e.CLIENT_ORIGIN,
    DATABASE_URL: e.DATABASE_URL,
    DATA_DIR: dataDir,
    PGLITE_DIR: pgliteDir === 'memory://' || isAbsolute(pgliteDir) ? pgliteDir : resolve(REPO_DIR, pgliteDir),
    DEV_MAIL_LOG: join(dataDir, 'dev-mail.log'),
    RESEND_API_KEY: e.RESEND_API_KEY,
    EMAIL_FROM: e.EMAIL_FROM ?? 'Virtual Office <office@localhost>',
    google:
      e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET
        ? { clientId: e.GOOGLE_CLIENT_ID, clientSecret: e.GOOGLE_CLIENT_SECRET }
        : undefined,
    MAP_PATH: isAbsolute(e.MAP_PATH) ? e.MAP_PATH : resolve(SERVER_DIR, e.MAP_PATH),
  }
}
