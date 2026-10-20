import { defineRoom, defineServer, matchMaker, type Server as ColyseusServer } from '@colyseus/core'
import { WebSocketTransport } from '@colyseus/ws-transport'
import { createDb } from '@vo/db'
import { API, API_ERRORS, ROOM_NAME, parseOfficeMap, validateOfficeMap, type ApiErrorCode, type OfficeMap } from '@vo/shared'
import { toNodeHandler } from 'better-auth/node'
import express, { type Application, type ErrorRequestHandler } from 'express'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http'
import { createAuth } from './auth/auth.ts'
import { createGetOfficeAccess } from './auth/membership.ts'
import { createVerifyAccessToken } from './auth/verifyAccessToken.ts'
import { createServices } from './chat/services.ts'
import type { Env } from './env.ts'
import { registerRoutes, type RouteDeps } from './http/routes.ts'
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
  const services = createServices(database.db)

  const httpServer = createServer()
  const realtime = createRealtimeServer({
    httpServer,
    clientOrigin: env.CLIENT_ORIGIN,
    roomDeps: { officeMap, verifyAccessToken, getOfficeAccess, store: createRoomStore(database.db), services },
    configureExpress: (app) => configureApi(app, { env, db: database.db, auth, mailer, getOfficeAccess, services }),
  })
  await realtime.listen(env.PORT)
  // Colyseus binds its request handler in listen(); no request has been read before this line.
  limitRequestBodies(httpServer)
  return {
    port: listeningPort(httpServer),
    async close() {
      await realtime.gracefullyShutdown(false)
      await database.close()
    },
  }
}

// Better Auth under /api/auth, then the other /api routes with JSON 404s and errors.
export function configureApi(app: Application, deps: RouteDeps): void {
  app.disable('x-powered-by')
  // Better Auth reads the raw body, so it goes before express.json().
  app.all(`${API.auth}/*splat`, toNodeHandler(deps.auth))
  app.use(express.json({ limit: '32kb' }))
  registerRoutes(app, deps)
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not_found' })
  })
  app.use(jsonErrors)
}

// Larger bodies are refused before any handler reads them.
export const MAX_BODY_BYTES = 64 * 1024

type RequestListener = (req: IncomingMessage, res: ServerResponse) => void

// Better Auth and the Colyseus matchmaker buffer request bodies without a limit. This puts one check in front of
// every 'request' listener of the server: 413 for a Content-Length above maxBytes, 411 for a body without one
// (chunked; browsers always send the length of a fetch body). Node never reads more than Content-Length bytes.
export function limitRequestBodies(httpServer: HttpServer, maxBytes = MAX_BODY_BYTES): void {
  const listeners = httpServer.listeners('request') as RequestListener[]
  httpServer.removeAllListeners('request')
  httpServer.on('request', (req: IncomingMessage, res: ServerResponse) => {
    const length = Number(req.headers['content-length'] ?? 0)
    const status = req.headers['transfer-encoding'] !== undefined ? 411 : length > maxBytes ? 413 : null
    if (status === null) {
      for (const listener of listeners) listener.call(httpServer, req, res)
      return
    }
    // Discard the body (never buffered) and close the connection after the answer.
    req.resume()
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', connection: 'close' })
    res.end(JSON.stringify({ error: status === 411 ? 'length_required' : 'payload_too_large' }))
  })
}

export interface RealtimeOptions {
  httpServer: HttpServer
  clientOrigin: string
  roomDeps: OfficeRoomDeps
  configureExpress?: (app: Application) => void
}

// Largest WebSocket message a client may send. The transport's default (4 KiB) is below a chat:send of
// CHAT_MAX_LENGTH characters (up to 3 bytes each in UTF-8); a larger message closes the connection (1009).
export const MAX_WS_MESSAGE_BYTES = 16 * 1024

// Colyseus with the office room. Tests use it with fake room deps; call listen(0) and read listeningPort().
export function createRealtimeServer(options: RealtimeOptions): ColyseusServer {
  hardenMatchmaker(options.clientOrigin)
  return defineServer({
    transport: new WebSocketTransport({ server: options.httpServer, maxPayload: MAX_WS_MESSAGE_BYTES }),
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

// body-parser errors (bad JSON, too large, unknown encoding) carry a 4xx status: the client's fault, not logged.
const jsonErrors: ErrorRequestHandler = (error: unknown, _req, res, next) => {
  if (res.headersSent) {
    next(error)
    return
  }
  const status = clientErrorStatus(error)
  if (status !== null) {
    const code: ApiErrorCode = status === 413 ? 'payload_too_large' : status === 415 ? 'unsupported_media_type' : 'invalid_request'
    res.status(API_ERRORS[code]).json({ error: code })
    return
  }
  console.error(error)
  res.status(500).json({ error: 'internal' })
}

function clientErrorStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null
  const status = 'status' in error ? error.status : 'statusCode' in error ? error.statusCode : undefined
  return typeof status === 'number' && status >= 400 && status < 500 ? status : null
}
