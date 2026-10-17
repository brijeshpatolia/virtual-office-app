import { createRemoteJWKSet, jwtVerify } from 'jose'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ACCESS_TOKEN_AUDIENCE } from '../../src/auth/verifyAccessToken.ts'
import { loadEnv, type Env } from '../../src/env.ts'
import { startServer, type RunningServer } from '../../src/server.ts'
import { readMails, TestClient } from './helpers.ts'

// The real startServer wiring (Colyseus + Express on one port), once per file: matchMaker is a process singleton.
let server: RunningServer
let env: Env
let dataDir: string
let baseUrl: string

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'vo-server-'))
  env = loadEnv({ NODE_ENV: 'test', PORT: '0', DATA_DIR: dataDir })
  server = await startServer(env)
  baseUrl = `http://127.0.0.1:${server.port}`
})

afterAll(async () => {
  await server?.close()
  await rm(dataDir, { recursive: true, force: true })
})

describe('startServer', () => {
  it('serves sign-in, companies and realtime tokens whose keys are published at /api/auth/jwks', async () => {
    const client = new TestClient(baseUrl, '10.9.0.1')
    expect((await client.post('/api/auth/email-otp/send-verification-otp', { email: 'sam@example.com', type: 'sign-in' })).status).toBe(200)
    const otp = (await readMails(env.DEV_MAIL_LOG)).at(-1)?.text.match(/code is (\d{6})/)?.[1]
    expect((await client.post('/api/auth/sign-in/email-otp', { email: 'sam@example.com', otp, name: 'Sam' })).status).toBe(200)

    const company = await client.post<{ orgId: string; officeId: string }>('/api/companies', { companyName: 'Wired', officeName: 'Wired HQ' })
    expect(company.status).toBe(201)
    const rt = await client.call<{ token: string }>(`/api/rt-token?officeId=${company.body.officeId}`)
    expect(rt.status).toBe(200)

    const jwks = createRemoteJWKSet(new URL(`${baseUrl}/api/auth/jwks`))
    const { payload } = await jwtVerify(rt.body.token, jwks, { issuer: env.BETTER_AUTH_URL, audience: ACCESS_TOKEN_AUDIENCE, algorithms: ['EdDSA'] })
    expect(payload).toMatchObject({ orgId: company.body.orgId, officeId: company.body.officeId, role: 'owner', name: 'Sam' })
  })

  it('answers JSON errors and CORS only for the client origin', async () => {
    const client = new TestClient(baseUrl, '10.9.0.2')
    const unknown = await client.call('/api/nope', { origin: 'http://evil.example' })
    expect(unknown).toMatchObject({ status: 404, body: { error: 'not_found' } })
    expect(unknown.headers.get('access-control-allow-origin')).toBe(env.CLIENT_ORIGIN)

    const response = await fetch(`${baseUrl}/api/companies`, {
      method: 'POST',
      headers: { origin: env.CLIENT_ORIGIN, 'content-type': 'application/json' },
      body: '{"companyName":',
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_request' })
  })
})
