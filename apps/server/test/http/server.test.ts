import { createRemoteJWKSet, jwtVerify } from 'jose'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import { gzipSync } from 'node:zlib'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ACCESS_TOKEN_AUDIENCE } from '../../src/auth/verifyAccessToken.ts'
import { loadEnv, type Env } from '../../src/env.ts'
import { MAX_BODY_BYTES, startServer, type RunningServer } from '../../src/server.ts'
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

afterEach(() => {
  vi.restoreAllMocks()
})

async function post(path: string, body: string | Uint8Array<ArrayBuffer>, headers: Record<string, string> = {}) {
  const response = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body })
  return { status: response.status, body: (await response.json()) as unknown }
}

// A body without Content-Length (Transfer-Encoding: chunked), which fetch does not send for a string.
function postChunked(path: string, chunks: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
      res.resume()
      resolve(res.statusCode ?? 0)
    })
    req.on('error', reject)
    const chunk = 'x'.repeat(16 * 1024)
    for (let i = 0; i < chunks; i++) req.write(chunk)
    req.end()
  })
}

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

  it('refuses large and chunked request bodies before Better Auth or the matchmaker read them', async () => {
    const big = JSON.stringify({ padding: 'x'.repeat(1024 * 1024) })
    for (const path of ['/api/auth/sign-out', '/matchmake/joinOrCreate/office', '/api/companies']) {
      expect(await post(path, big, { origin: env.CLIENT_ORIGIN }), path).toEqual({ status: 413, body: { error: 'payload_too_large' } })
      expect(await postChunked(path, 8), path).toBe(411)
    }
    expect(await post('/api/auth/sign-out', JSON.stringify({ padding: 'x'.repeat(MAX_BODY_BYTES - 100) }))).toMatchObject({ status: 200 })
    // The server still answers after that.
    expect((await fetch(`${baseUrl}/api/config`)).status).toBe(200)
  })

  it('answers 4xx without a log line for bodies that are too large, badly encoded or not JSON', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const json = { 'content-type': 'application/json' }
    expect(await post('/api/companies', JSON.stringify({ companyName: 'x'.repeat(40_000) }))).toEqual({ status: 413, body: { error: 'payload_too_large' } })
    expect(await post('/api/companies', 'not json', json)).toEqual({ status: 400, body: { error: 'invalid_request' } })
    expect(await post('/api/companies', new Uint8Array([1, 2, 3]), { 'content-encoding': 'br' })).toEqual({ status: 400, body: { error: 'invalid_request' } })
    expect(await post('/api/companies', new Uint8Array(gzipSync('{}')), { 'content-encoding': 'compress' })).toEqual({
      status: 415,
      body: { error: 'unsupported_media_type' },
    })
    expect(logged).not.toHaveBeenCalled()
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
