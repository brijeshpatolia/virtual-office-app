import { Client } from '@colyseus/sdk'
import { createDb, presenceSessions } from '@vo/db'
import { ROOM_NAME } from '@vo/shared'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadEnv, type Env } from '../../src/env.ts'
import { startServer, type RunningServer } from '../../src/server.ts'
import { readMails, TestClient } from '../http/helpers.ts'

// The real wiring of startServer: Better Auth, /api/rt-token, the office room and its store on one port. PGlite
// lives on disk, so the test can read presence_sessions after the server has shut down.
let dataDir: string
let env: Env
let server: RunningServer
let baseUrl: string
let running = false

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'vo-wired-'))
  env = loadEnv({ NODE_ENV: 'test', PORT: '0', DATA_DIR: dataDir, PGLITE_DIR: join(dataDir, 'pglite') })
  server = await startServer(env)
  running = true
  baseUrl = `http://127.0.0.1:${server.port}`
})

afterAll(async () => {
  if (running) await server.close()
  await rm(dataDir, { recursive: true, force: true })
})

async function signUp(email: string, name: string, ip: string): Promise<TestClient> {
  const client = new TestClient(baseUrl, ip)
  await client.post('/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' })
  const otp = (await readMails(env.DEV_MAIL_LOG)).filter((mail) => mail.to === email).at(-1)?.text.match(/code is (\d{6})/)?.[1]
  expect((await client.post('/api/auth/sign-in/email-otp', { email, otp, name })).status).toBe(200)
  return client
}

async function companyWithToken(client: TestClient, companyName: string) {
  const company = await client.post<{ orgId: string; officeId: string }>('/api/companies', { companyName, officeName: 'HQ' })
  expect(company.status).toBe(201)
  const rt = await client.call<{ token: string }>(`/api/rt-token?officeId=${company.body.officeId}`)
  expect(rt.status).toBe(200)
  return { ...company.body, token: rt.body.token }
}

function sdk(token: string): Client {
  const client = new Client(baseUrl)
  client.auth.token = token
  return client
}

describe('startServer with the office room', () => {
  it('lets members in with their realtime token, keeps other companies out and closes presence rows on shutdown', async () => {
    const ann = await signUp('ann@example.com', 'Ann', '10.8.0.1')
    const acme = await companyWithToken(ann, 'Acme')
    const cleo = await signUp('cleo@example.com', 'Cleo', '10.8.0.2')
    const other = await companyWithToken(cleo, 'Other')

    const room = await sdk(acme.token).joinOrCreate(ROOM_NAME, { officeId: acme.officeId })
    await new Promise<void>((resolve) => room.onStateChange.once(() => resolve()))
    const players = [...(room.state as { players: Map<string, { name: string }> }).players.values()]
    expect(players.map((p) => p.name)).toEqual(['Ann'])

    // Cleo gets no token for Acme's office, and her own token does not open it.
    expect((await cleo.call(`/api/rt-token?officeId=${acme.officeId}`)).status).toBe(404)
    await expect(sdk(other.token).joinOrCreate(ROOM_NAME, { officeId: acme.officeId })).rejects.toMatchObject({ code: 525 })

    // Shut down while Ann is still in the room: her presence row must be closed before the database is.
    running = false
    await server.close()
    const reopened = await createDb({ PGLITE_DIR: env.PGLITE_DIR })
    try {
      const rows = await reopened.db.select().from(presenceSessions)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ orgId: acme.orgId, officeId: acme.officeId })
      expect(rows[0]?.leftAt).toBeInstanceOf(Date)
    } finally {
      await reopened.close()
    }
  })
})
