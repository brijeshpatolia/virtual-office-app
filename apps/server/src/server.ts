import { defineRoom, defineServer, matchMaker, type Server as ColyseusServer } from '@colyseus/core'
import { WebSocketTransport } from '@colyseus/ws-transport'
import { createDb } from '@vo/db'
import { API, ROOM_NAME, parseOfficeMap, validateOfficeMap, type OfficeMap } from '@vo/shared'
import { toNodeHandler } from 'better-auth/node'
import express, { type Application, type ErrorRequestHandler } from 'express'
import { readFile } from 'node:fs/promises'
import { createServer, type Server as HttpServer } from 'node:http'
import { createAuth } from './auth/auth.ts'
import { createGetOfficeAccess } from './auth/membership.ts'
import { createVerifyAccessToken } from './auth/verifyAccessToken.ts'
import type { Env } from './env.ts'
import { registerRoutes } from './http/routes.ts'
import { createMailer } from './mail/mailer.ts'
import { createOfficeRoom, type OfficeRoomDeps } from './rooms/OfficeRoom.ts'
import { createRoomStore } from './rooms/store.ts'

export interface RunningServer {
  port: number
  close(): Promise<void>
}

// The office server: Express (Better Auth + /api) and Colyseus on one HTTP server and port.
export async function startServer(env: Env): Promise<RunningServer> {
  const officeMap = await loadOfficeMap(env.MAP_PATH)
  const database = await createDb(env)
  const mailer = createMailer(env)
  const auth = createAuth({ env, db: database.db, mailer })
  const getOfficeAccess = createGetOfficeAccess(database.db)
  const verifyAccessToken = createVerifyAccessToken({ env, auth })

  const httpServer = createServer()
  const realtime = createRealtimeServer({
    httpServer,
    clientOrigin: env.CLIENT_ORIGIN,
    roomDeps: { officeMap, verifyAccessToken, getOfficeAccess, store: createRoomStore(database.db) },
    configureExpress: (app) => {
      app.disable('x-powered-by')
      // Better Auth reads the raw body, so it goes before express.json().
      app.all(`${API.auth}/*splat`, toNodeHandler(auth))
      app.use(express.json({ limit: '32kb' }))
      registerRoutes(app, { env, db: database.db, auth, mailer, getOfficeAccess })
      app.use('/api', (_req, res) => {
        res.status(404).json({ error: 'not_found' })
      })
      app.use(jsonErrors)
    },
  })
  await realtime.listen(env.PORT)
  return {
    port: listeningPort(httpServer),
    async close() {
      await realtime.gracefullyShutdown(false)
      await database.close()
    },
  }
}

export interface RealtimeOptions {
  httpServer: HttpServer
  clientOrigin: string
  roomDeps: OfficeRoomDeps
  configureExpress?: (app: Application) => void
}

// Colyseus with the office room. Tests use it with fake room deps; call listen(0) and read listeningPort().
export function createRealtimeServer(options: RealtimeOptions): ColyseusServer {
  hardenMatchmaker(options.clientOrigin)
  return defineServer({
    transport: new WebSocketTransport({ server: options.httpServer }),
    greet: false,
    // index.ts handles SIGINT/SIGTERM and calls close().
    gracefullyShutdown: false,
    rooms: { [ROOM_NAME]: defineRoom(createOfficeRoom(options.roomDeps)).filterBy(['officeId']) },
    express: options.configureExpress,
  })
}

// Colyseus answers every HTTP request with CORS headers for any origin, with credentials. Allow only the client.
// Clients may only joinOrCreate (and reconnect): joinById/create would let a token for office A enter, or split,
// another room.
export function hardenMatchmaker(clientOrigin: string): void {
  matchMaker.controller.exposedMethods = ['joinOrCreate', 'reconnect']
  matchMaker.controller.getCorsHeaders = () => ({ 'Access-Control-Allow-Origin': clientOrigin })
}

export function listeningPort(httpServer: HttpServer): number {
  const address = httpServer.address()
  if (address === null || typeof address === 'string') throw new Error('The HTTP server is not listening on a port')
  return address.port
}

export async function loadOfficeMap(path: string): Promise<OfficeMap> {
  const map = parseOfficeMap(JSON.parse(await readFile(path, 'utf8')))
  const issues = validateOfficeMap(map)
  if (issues.length > 0) {
    throw new Error(`Office map ${path} has ${issues.length} issues:\n${issues.map((i) => `  - [${i.code}] ${i.message}`).join('\n')}`)
  }
  return map
}

const jsonErrors: ErrorRequestHandler = (error: unknown, _req, res, next) => {
  if (res.headersSent) {
    next(error)
    return
  }
  const parseFailed = typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.parse.failed'
  if (parseFailed) {
    res.status(400).json({ error: 'invalid_request' })
    return
  }
  console.error(error)
  res.status(500).json({ error: 'internal' })
}
