import { createDb, type DbHandle } from '@vo/db'
import express from 'express'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAuth, type Auth } from '../../src/auth/auth.ts'
import { createGetOfficeAccess, type GetOfficeAccess } from '../../src/auth/membership.ts'
import { createVerifyAccessToken, type VerifyAccessToken } from '../../src/auth/verifyAccessToken.ts'
import { createServices } from '../../src/chat/services.ts'
import { loadEnv, type Env } from '../../src/env.ts'
import { createMailer } from '../../src/mail/mailer.ts'
import { configureApi, limitRequestBodies, listeningPort } from '../../src/server.ts'

export const CLIENT_ORIGIN = 'http://localhost:8000'

export interface SentMail {
  to: string
  subject: string
  text: string
  at: string
}

export interface TestApi {
  env: Env
  database: DbHandle
  auth: Auth
  getOfficeAccess: GetOfficeAccess
  verifyAccessToken: VerifyAccessToken
  baseUrl: string
  client(): TestClient
  mails(): Promise<SentMail[]>
  close(): Promise<void>
}

// The HTTP side of startServer (configureApi and the body limit) on a random port, with an
// in-memory PGlite and the dev mailer writing to a temporary DATA_DIR. `vars` adds environment variables.
export async function startTestApi(vars: Record<string, string> = {}): Promise<TestApi> {
  const dataDir = await mkdtemp(join(tmpdir(), 'vo-http-'))
  const env = loadEnv({ ...vars, NODE_ENV: 'test', PORT: '0', DATA_DIR: dataDir })
  const database = await createDb(env)
  const mailer = createMailer(env)
  const auth = createAuth({ env, db: database.db, mailer })
  const getOfficeAccess = createGetOfficeAccess(database.db)
  const verifyAccessToken = createVerifyAccessToken({ env, auth })

  const app = express()
  configureApi(app, { env, db: database.db, auth, mailer, getOfficeAccess, services: createServices(database.db) })
  const httpServer = createServer(app)
  limitRequestBodies(httpServer)
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${listeningPort(httpServer)}`
  let clients = 0

  return {
    env,
    database,
    auth,
    getOfficeAccess,
    verifyAccessToken,
    baseUrl,
    // Each client has its own cookies and its own IP (x-forwarded-for), so Better Auth's per-IP rate limits
    // (3 sign-ins per 10 s, 3 codes per 60 s) apply per test user.
    client: () => new TestClient(baseUrl, `10.0.${Math.floor(++clients / 250)}.${(clients % 250) + 1}`),
    mails: () => readMails(env.DEV_MAIL_LOG),
    async close() {
      await new Promise<void>((resolve, reject) => httpServer.close((error) => (error ? reject(error) : resolve())))
      await database.close()
      await rm(dataDir, { recursive: true, force: true })
    },
  }
}

export async function readMails(logPath: string): Promise<SentMail[]> {
  const text = await readFile(logPath, 'utf8').catch(() => '')
  return text
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as SentMail)
}

export interface CallOptions {
  method?: string
  body?: unknown
  // Default CLIENT_ORIGIN; null sends no Origin header.
  origin?: string | null
}

export interface CallResult<T = Record<string, unknown>> {
  status: number
  body: T
  headers: Headers
}

export interface SignedInUser {
  id: string
  email: string
  name: string
}

export class TestClient {
  readonly cookies = new Map<string, string>()
  user: SignedInUser | undefined
  readonly baseUrl: string
  readonly ip: string

  constructor(baseUrl: string, ip: string) {
    this.baseUrl = baseUrl
    this.ip = ip
  }

  get userId(): string {
    if (!this.user) throw new Error('Not signed in')
    return this.user.id
  }

  // Default method: POST when a body is given, else GET.
  async call<T = Record<string, unknown>>(path: string, options: CallOptions = {}): Promise<CallResult<T>> {
    const headers = new Headers({ 'x-forwarded-for': this.ip })
    const origin = options.origin === undefined ? CLIENT_ORIGIN : options.origin
    if (origin !== null) headers.set('origin', origin)
    if (options.body !== undefined) headers.set('content-type', 'application/json')
    if (this.cookies.size > 0) headers.set('cookie', [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '))
    const response = await fetch(this.baseUrl + path, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
    for (const cookie of response.headers.getSetCookie()) {
      const [pair = '', ...attributes] = cookie.split(';')
      const at = pair.indexOf('=')
      const name = pair.slice(0, at).trim()
      const value = pair.slice(at + 1).trim()
      const expired = attributes.some((a) => /^\s*max-age=0\s*$/i.test(a))
      if (value === '' || expired) this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
    const text = await response.text()
    const json = response.headers.get('content-type')?.includes('json') && text !== ''
    return { status: response.status, body: (json ? JSON.parse(text) : text || null) as T, headers: response.headers }
  }

  post<T = Record<string, unknown>>(path: string, body: unknown = {}, options: CallOptions = {}): Promise<CallResult<T>> {
    return this.call<T>(path, { ...options, method: 'POST', body })
  }
}

export async function requestCode(api: TestApi, client: TestClient, email: string): Promise<string> {
  const sent = await client.post('/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' })
  if (sent.status !== 200) throw new Error(`send-verification-otp: ${sent.status} ${JSON.stringify(sent.body)}`)
  const mail = (await api.mails()).filter((m) => m.to === email).at(-1)
  const code = mail?.text.match(/code is (\d{6})/)?.[1]
  if (!code) throw new Error(`No sign-in code for ${email} in the dev mail log`)
  return code
}

// Signs in (or up) with email OTP, reading the code from the dev mail log.
export async function signIn(api: TestApi, client: TestClient, email: string, name?: string): Promise<SignedInUser> {
  const otp = await requestCode(api, client, email)
  const result = await client.post<{ user: SignedInUser }>('/api/auth/sign-in/email-otp', { email, otp, name })
  if (result.status !== 200) throw new Error(`sign-in: ${result.status} ${JSON.stringify(result.body)}`)
  client.user = result.body.user
  return result.body.user
}

export async function newUser(api: TestApi, email: string, name?: string): Promise<TestClient> {
  const client = api.client()
  await signIn(api, client, email, name)
  return client
}

export async function createCompany(client: TestClient, companyName: string, officeName = `${companyName} HQ`) {
  const result = await client.post<{ orgId: string; officeId: string }>('/api/companies', { companyName, officeName })
  if (result.status !== 201) throw new Error(`create company: ${result.status} ${JSON.stringify(result.body)}`)
  return result.body
}

export async function createInviteLink(client: TestClient, officeId: string, body: Record<string, unknown>) {
  const result = await client.post<{ url: string; token: string; expiresAt: string }>(`/api/offices/${officeId}/invite-links`, body)
  if (result.status !== 201) throw new Error(`create invite link: ${result.status} ${JSON.stringify(result.body)}`)
  return result.body
}
