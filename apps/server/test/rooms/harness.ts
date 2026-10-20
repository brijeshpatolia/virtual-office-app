import { matchMaker, type Server } from '@colyseus/core'
import type { IRef } from '@colyseus/schema'
import { Client, type Room } from '@colyseus/sdk'
import {
  FEET_OFFSET_Y,
  MSG,
  ROOM_NAME,
  type MoveReject,
  type OfficeMap,
  type OfficeStateView,
  type OrgRole,
  type Point,
  type ZoneType,
} from '@vo/shared'
import { SignJWT, generateKeyPair, jwtVerify, type CryptoKey } from 'jose'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { expect } from 'vitest'
import type { OfficeAccess } from '../../src/auth/membership.ts'
import type { AccessClaims } from '../../src/auth/verifyAccessToken.ts'
import type { OfficeState, Player } from '../../src/rooms/state.ts'
import type { OfficeRoomSettings, RoomStore } from '../../src/rooms/store.ts'
import { createRealtimeServer, listeningPort, loadOfficeMap } from '../../src/server.ts'

// The office room on a random port with fake auth deps, a fake clock and SDK clients, as the browser uses them.

export const CLIENT_ORIGIN = 'http://localhost:8000'
const ISSUER = CLIENT_ORIGIN
const AUDIENCE = 'vo-realtime'
const MAP_PATH = fileURLToPath(new URL('../../../client/public/assets/map/map.json', import.meta.url))

export type Synced<T> = IRef & {
  readonly [K in keyof T]: T[K] extends ReadonlyMap<infer Key, infer V> ? ReadonlyMap<Key, Synced<V>> & IRef : T[K]
}
export type OfficeRoomView = Room<unknown, Synced<OfficeStateView>>

export interface TestUser {
  userId: string
  name: string
  orgId: string
}

export const loadMap = () => loadOfficeMap(MAP_PATH)

// The map with extra wall cells, extra seats or other zone capacities, for one test file.
export function withChanges(
  map: OfficeMap,
  changes: { walls?: [number, number][]; seats?: OfficeMap['seats']; capacity?: Record<string, number> },
): OfficeMap {
  const T = map.tileWidth
  return {
    ...map,
    zones: map.zones.map((zone) => ({ ...zone, capacity: changes.capacity?.[zone.id] ?? zone.capacity })),
    seats: [...map.seats, ...(changes.seats ?? [])],
    colliders: [
      ...map.colliders,
      ...(changes.walls ?? []).map(([col, row]) => ({
        name: 'test',
        kind: 'wall' as const,
        rect: { x: col * T, y: row * T, w: T, h: T },
      })),
    ],
  }
}

export class FakeClock {
  ms = 1_000_000
  readonly now = (): number => this.ms
  advance(ms: number): void {
    this.ms += ms
  }
}

export class FakeStore implements RoomStore {
  readonly settings = new Map<string, OfficeRoomSettings>()
  readonly started: { id: string; orgId: string; officeId: string; userId: string }[] = []
  readonly ended: { orgId: string; presenceId: string }[] = []

  async loadSettings(_orgId: string, officeId: string): Promise<OfficeRoomSettings> {
    return this.settings.get(officeId) ?? { guestZoneTypes: ['lobby', 'meeting'] satisfies ZoneType[] }
  }

  async startPresence(orgId: string, officeId: string, userId: string): Promise<string> {
    const id = `presence-${this.started.length + 1}`
    this.started.push({ id, orgId, officeId, userId })
    return id
  }

  async endPresence(orgId: string, presenceId: string): Promise<void> {
    this.ended.push({ orgId, presenceId })
  }
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export async function waitFor(check: () => boolean, what = 'condition', timeoutMs = 3000): Promise<void> {
  const until = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > until) throw new Error(`Timed out waiting for ${what}`)
    await sleep(5)
  }
}

export interface RoomServer {
  readonly clock: FakeClock
  readonly store: FakeStore
  readonly endpoint: string
  grant(user: TestUser, officeId: string, role?: OrgRole): void
  revoke(user: TestUser, officeId: string): void
  token(user: TestUser, officeId: string, options?: { expiresAt?: number; key?: CryptoKey; orgId?: string }): Promise<string>
  join(user: TestUser, officeId: string): Promise<TestPlayer>
  close(): Promise<void>
}

export async function startRoomServer(officeMap: OfficeMap): Promise<RoomServer> {
  const { publicKey, privateKey } = await generateKeyPair('EdDSA')
  const clock = new FakeClock()
  const store = new FakeStore()
  const access = new Map<string, OfficeAccess>()
  const key = (userId: string, officeId: string) => `${userId}/${officeId}`

  const verifyAccessToken = async (token: string): Promise<AccessClaims> => {
    const { payload } = await jwtVerify(token, publicKey, { issuer: ISSUER, audience: AUDIENCE, algorithms: ['EdDSA'] })
    const claim = (name: string) => String(payload[name] ?? '')
    return { userId: payload.sub ?? '', orgId: claim('orgId'), officeId: claim('officeId'), role: claim('role') as OrgRole, name: claim('name') }
  }
  const getOfficeAccess = async (userId: string, officeId: string) => access.get(key(userId, officeId)) ?? null

  const httpServer = createServer()
  const server: Server = createRealtimeServer({
    httpServer,
    clientOrigin: CLIENT_ORIGIN,
    roomDeps: { officeMap, verifyAccessToken, getOfficeAccess, store, now: clock.now },
  })
  await server.listen(0)
  const endpoint = `http://127.0.0.1:${listeningPort(httpServer)}`

  const roomServer: RoomServer = {
    clock,
    store,
    endpoint,
    grant(user, officeId, role = 'member') {
      access.set(key(user.userId, officeId), { orgId: user.orgId, role, officeName: officeId })
    },
    revoke(user, officeId) {
      access.delete(key(user.userId, officeId))
    },
    async token(user, officeId, options = {}) {
      const nowSeconds = Math.floor(Date.now() / 1000)
      const role = access.get(key(user.userId, officeId))?.role ?? 'member'
      return new SignJWT({ orgId: options.orgId ?? user.orgId, officeId, role, name: user.name })
        .setProtectedHeader({ alg: 'EdDSA' })
        .setSubject(user.userId)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt(nowSeconds)
        .setExpirationTime(options.expiresAt ?? nowSeconds + 900)
        .sign(options.key ?? privateKey)
    },
    async join(user, officeId) {
      const client = new Client(endpoint)
      client.auth.token = await roomServer.token(user, officeId)
      const room = await client.joinOrCreate<Synced<OfficeStateView>>(ROOM_NAME, { officeId })
      const player = new TestPlayer(room, clock)
      await waitFor(() => room.state.players?.get(room.sessionId) !== undefined, 'the own player in the client state')
      return player
    },
    close: () => server.gracefullyShutdown(false),
  }
  return roomServer
}

export const STEP_PX = 40
export const STEP_MS = 250

// One SDK client in a room, with helpers that walk it along feet points and read the server's view of it.
export class TestPlayer {
  readonly room: OfficeRoomView
  readonly rejects: MoveReject[] = []
  closeCode: number | null = null
  readonly #clock: FakeClock
  #seq = 0

  constructor(room: OfficeRoomView, clock: FakeClock) {
    this.room = room
    this.#clock = clock
    room.onMessage(MSG.moveReject, (reject: MoveReject) => this.rejects.push(reject))
    room.onLeave((code) => {
      this.closeCode = code
    })
  }

  get sessionId(): string {
    return this.room.sessionId
  }

  serverState(): OfficeState {
    return (matchMaker.getLocalRoomById(this.room.roomId) as unknown as { state: OfficeState }).state
  }

  server(): Player {
    const player = this.serverState().players.get(this.sessionId)
    if (player === undefined) throw new Error(`No server player for ${this.sessionId}`)
    return player
  }

  feet(): Point {
    const { x, y } = this.server()
    return { x, y: y + FEET_OFFSET_Y }
  }

  // Sends one move to the feet point after advancing the clock by dtMs. Resolves the reject, or null once the
  // server accepted it.
  async moveTo(target: Point, dtMs = STEP_MS): Promise<MoveReject | null> {
    this.#clock.advance(dtMs)
    const seq = ++this.#seq
    const x = target.x
    const y = target.y - FEET_OFFSET_Y
    const before = this.rejects.length
    this.room.send(MSG.move, { x, y, dir: 'down', moving: true, seq })
    let reject: MoveReject | null = null
    await waitFor(() => {
      reject = this.rejects.slice(before).find((r) => r.seq === seq) ?? null
      const p = this.server()
      return reject !== null || (Math.abs(p.x - x) < 0.01 && Math.abs(p.y - y) < 0.01)
    }, `move ${seq} to (${target.x}, ${target.y})`)
    return reject
  }

  // Walks to each feet point in turn, in steps of at most STEP_PX every STEP_MS (160 px/s); every step must pass.
  async walk(...points: Point[]): Promise<void> {
    for (const point of points) {
      const from = this.feet()
      // A move to the current position could not be told apart from one the server has not read yet.
      const length = Math.hypot(point.x - from.x, point.y - from.y)
      const steps = length < 0.01 ? 0 : Math.ceil(length / STEP_PX)
      for (let i = 1; i <= steps; i++) {
        const step = { x: from.x + ((point.x - from.x) * i) / steps, y: from.y + ((point.y - from.y) * i) / steps }
        const reject = await this.moveTo(step)
        expect(reject, `step to (${step.x}, ${step.y})`).toBeNull()
      }
    }
  }

  async leave(): Promise<void> {
    await this.room.leave(true)
  }
}

export function seatState(player: TestPlayer, seatId: string): string | undefined {
  return player.room.state.seats.get(seatId)?.occupantId
}
