import {
  CloseCode,
  Deferred,
  ErrorCode,
  Room,
  ServerError,
  type Client,
  type MessageContext,
  type RoomException,
  type RoomMethodName,
} from '@colyseus/core'
import {
  AWAY_AFTER_MS,
  FEET_OFFSET_Y,
  HIDDEN_AWAY_AFTER_MS,
  JoinOptionsSchema,
  MAIN_SPAWN_ID,
  MAX_MESSAGES_PER_SECOND,
  MOVE_BURST,
  MOVE_RATE_HZ,
  MSG,
  MoveMessageSchema,
  PATCH_RATE_MS,
  PresenceActivitySchema,
  RECONNECT_SECONDS,
  ROOM_CLOSE,
  SIT_RADIUS,
  SitRequestSchema,
  ZoneTracker,
  avatarColor,
  buildGrid,
  checkMove,
  distance,
  fullMoveBudget,
  lineOfSight,
  nearestFreeStandSpot,
  spendMoveBudget,
  sweptSegmentBlocked,
  zoneAt,
  zoneEntryBlock,
  type Facing,
  type MoveBudget,
  type MoveMessage,
  type MoveRejectReason,
  type OrgRole,
  type OfficeMap,
  type Point,
  type ServerMessages,
  type SitResponse,
  type StandResponse,
  type ZoneDef,
} from '@vo/shared'
import type { GetOfficeAccess } from '../auth/membership.ts'
import type { VerifyAccessToken } from '../auth/verifyAccessToken.ts'
import { OfficeState, Player, Seat } from './state.ts'
import { DEFAULT_ROOM_SETTINGS, type OfficeRoomSettings, type RoomStore } from './store.ts'

export interface OfficeRoomDeps {
  officeMap: OfficeMap
  verifyAccessToken: VerifyAccessToken
  getOfficeAccess: GetOfficeAccess
  // Office settings and presence_sessions rows (createRoomStore). Without it the room uses the default settings
  // and records no presence.
  store?: RoomStore
  // Clock in ms; tests pass a fake one.
  now?: () => number
}

// client.auth of a joined client: the value static onAuth returns.
export interface RoomAuth {
  userId: string
  name: string
  orgId: string
  officeId: string
  role: OrgRole
}

export type OfficeClient = Client<{ auth: RoomAuth; messages: ServerMessages }>

// The client sends MOVE_RATE_HZ moves plus one per stop or turn. Above this rate (and MOVE_BURST at once) a move
// gets move:reject 'speed'.
export const MOVE_LIMIT_PER_SECOND = 2 * MOVE_RATE_HZ
// The close codes after which the SDK reconnects by itself; only for these the room keeps a dropped player.
const RECONNECTING_CLOSE_CODES: ReadonlySet<number> = new Set([
  CloseCode.GOING_AWAY,
  CloseCode.NO_STATUS_RECEIVED,
  CloseCode.ABNORMAL_CLOSURE,
  CloseCode.MAY_TRY_RECONNECT,
])
// How often the room checks that every user still has access to the office (removed members are closed with
// ROOM_CLOSE.removed).
export const ACCESS_RECHECK_MS = 60_000
const TICK_MS = 1000
// Players who join one after another stand a few px apart at the spawn point.
const SPAWN_SPREAD = 12
const SPAWN_OFFSETS: readonly Point[] = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
].map(([dx = 0, dy = 0]) => ({ x: dx * SPAWN_SPREAD, y: dy * SPAWN_SPREAD }))

interface RateBucket {
  tokens: number
  atMs: number
}

// Server-only state of one session (one user; a second tab replaces the session).
interface Session {
  readonly sessionId: string
  readonly userId: string
  role: OrgRole
  // null while the room waits for a dropped client to reconnect.
  client: OfficeClient | null
  reconnection: Deferred<OfficeClient> | null
  // The last accepted position (sprite centre) and the server time it was accepted at.
  pos: Point
  movedAt: number
  budget: MoveBudget
  moves: RateBucket
  zones: ZoneTracker
  activeAt: number
  hiddenSince: number | null
  presenceId: Promise<string | null>
}

function takeToken(bucket: RateBucket, nowMs: number): boolean {
  const refill = (Math.max(0, nowMs - bucket.atMs) * MOVE_LIMIT_PER_SECOND) / 1000
  bucket.tokens = Math.min(MOVE_BURST, bucket.tokens + refill)
  bucket.atMs = Math.max(nowMs, bucket.atMs)
  if (bucket.tokens < 1) return false
  bucket.tokens -= 1
  return true
}

const feetOf = (p: Point): Point => ({ x: p.x, y: p.y + FEET_OFFSET_Y })

const unauthorized = () => new ServerError(ErrorCode.AUTH_FAILED, 'unauthorized')

async function authorize(deps: OfficeRoomDeps, token: unknown, options: unknown): Promise<RoomAuth | null> {
  const parsed = JoinOptionsSchema.safeParse(options)
  if (!parsed.success || typeof token !== 'string' || token === '') return null
  const { officeId } = parsed.data
  const claims = await deps.verifyAccessToken(token).catch(() => null)
  if (claims === null || claims.officeId !== officeId) return null
  const access = await deps.getOfficeAccess(claims.userId, officeId)
  if (access === null || access.orgId !== claims.orgId) return null
  return { userId: claims.userId, name: claims.name, orgId: access.orgId, officeId, role: access.role }
}

// One room per office (defineRoom(...).filterBy(['officeId'])). The deps are closed over, because Colyseus
// creates the room and calls the static onAuth itself. The map and its grids are built once per process.
export function createOfficeRoom(deps: OfficeRoomDeps) {
  const map = deps.officeMap
  const now = deps.now ?? (() => performance.now())
  const walkGrid = buildGrid(map, ['wall', 'furniture'])
  const wallGrid = buildGrid(map, ['wall'])
  const seatDefs = new Map(map.seats.map((seat) => [seat.id, seat]))
  const spawn = map.spawns.find((s) => s.id === MAIN_SPAWN_ID)
  if (spawn === undefined) throw new Error(`The office map has no spawn "${MAIN_SPAWN_ID}"`)
  const spawnZoneId = zoneAt(map, spawn.x, spawn.y)?.id

  return class OfficeRoom extends Room<{ state: OfficeState; client: OfficeClient }> {
    #officeId = ''
    #orgId = ''
    #settings: Promise<OfficeRoomSettings> | null = null
    #guestZoneTypes = DEFAULT_ROOM_SETTINGS.guestZoneTypes
    readonly #sessions = new Map<string, Session>()
    readonly #sessionOfUser = new Map<string, string>()
    #accessCheckedAt = now()
    #checkingAccess = false
    // Presence rows still being closed; onDispose waits for them, so a shutdown does not close the database first.
    readonly #pendingWrites = new Set<Promise<void>>()

    // Runs during the matchmake request, before the room is found or created. The client learns only "unauthorized".
    static override async onAuth(token: unknown, options: unknown): Promise<RoomAuth> {
      const auth = await authorize(deps, token, options).catch((error: unknown) => {
        console.error('OfficeRoom.onAuth failed:', error)
        return null
      })
      if (auth === null) throw unauthorized()
      return auth
    }

    override onCreate(options: unknown) {
      this.#officeId = JoinOptionsSchema.parse(options).officeId
      this.setState(new OfficeState())
      for (const seat of map.seats) this.state.seats.set(seat.id, new Seat())
      this.setPatchRate(PATCH_RATE_MS)
      this.maxMessagesPerSecond = MAX_MESSAGES_PER_SECOND
      this.onMessage(MSG.move, (client, message) => this.#move(client, message))
      this.onMessage(MSG.activity, (client, message) => this.#activity(client, message))
      this.onMessage(MSG.sit, (client, message, ctx) => this.#sit(client, message, ctx))
      this.onMessage(MSG.stand, (client, _message, ctx) => this.#stand(client, ctx))
      this.clock.setInterval(() => this.#tick(), TICK_MS)
    }

    override async onJoin(client: OfficeClient) {
      const auth = client.auth
      if (auth === undefined || auth.officeId !== this.#officeId) throw unauthorized()
      if (this.#orgId === '') this.#orgId = auth.orgId
      if (auth.orgId !== this.#orgId) throw unauthorized()
      this.#guestZoneTypes = (await this.#loadSettings()).guestZoneTypes

      // Everything below is synchronous, so two joins of one user cannot interleave.
      const previous = this.#sessionOfUser.get(auth.userId)
      const old = previous === undefined ? undefined : this.#sessions.get(previous)
      if (old !== undefined) this.#close(old, ROOM_CLOSE.replaced)

      const at = now()
      const pos = this.#spawnPosition()
      const zones = new ZoneTracker(map, { dwellMs: 0 })
      const zoneId = zones.update(pos.x, pos.y + FEET_OFFSET_Y, at).zoneId ?? ''
      const session: Session = {
        sessionId: client.sessionId,
        userId: auth.userId,
        role: auth.role,
        client,
        reconnection: null,
        pos,
        movedAt: at,
        budget: fullMoveBudget(at),
        moves: { tokens: MOVE_BURST, atMs: at },
        zones,
        activeAt: at,
        hiddenSince: null,
        presenceId: this.#startPresence(auth.userId),
      }
      this.#sessions.set(client.sessionId, session)
      this.#sessionOfUser.set(auth.userId, client.sessionId)
      const player = new Player({ userId: auth.userId, name: auth.name, color: avatarColor(auth.userId), x: pos.x, y: pos.y })
      player.zoneId = zoneId
      this.state.players.set(client.sessionId, player)
    }

    // A connection closed without consent: keep the player for RECONNECT_SECONDS, if the SDK will try to reconnect.
    // Otherwise (e.g. 4002 after too many messages) Colyseus calls onLeave next, which removes the player.
    override onDrop(client: OfficeClient, code?: number) {
      const session = this.#sessions.get(client.sessionId)
      if (session === undefined || code === undefined || !RECONNECTING_CLOSE_CODES.has(code)) return
      session.client = null
      const player = this.state.players.get(client.sessionId)
      if (player !== undefined) player.moving = false
      const reconnection = this.allowReconnection(client, RECONNECT_SECONDS)
      // allowReconnection hands back a plain rejected promise when the client never finished joining; onLeave follows.
      if (reconnection instanceof Deferred) session.reconnection = reconnection
      reconnection.catch(() => undefined)
    }

    override onReconnect(client: OfficeClient) {
      const session = this.#sessions.get(client.sessionId)
      if (session === undefined) return
      session.client = client
      session.reconnection = null
    }

    // A consented leave, or a dropped client that did not come back in time.
    override onLeave(client: OfficeClient) {
      const session = this.#sessions.get(client.sessionId)
      if (session !== undefined) this.#remove(session)
    }

    override async onDispose() {
      await Promise.all(this.#pendingWrites)
    }

    override onUncaughtException(error: RoomException, methodName: RoomMethodName) {
      console.error(`OfficeRoom ${this.#officeId}: ${methodName} failed:`, error.cause ?? error)
    }

    #loadSettings(): Promise<OfficeRoomSettings> {
      const store = deps.store
      if (store === undefined) return Promise.resolve(DEFAULT_ROOM_SETTINGS)
      this.#settings ??= store.loadSettings(this.#orgId, this.#officeId).catch((error: unknown) => {
        console.error(`OfficeRoom ${this.#officeId}: could not load the office settings:`, error)
        this.#settings = null
        return DEFAULT_ROOM_SETTINGS
      })
      return this.#settings
    }

    #startPresence(userId: string): Promise<string | null> {
      const store = deps.store
      if (store === undefined) return Promise.resolve(null)
      return store.startPresence(this.#orgId, this.#officeId, userId).catch((error: unknown) => {
        console.error(`OfficeRoom ${this.#officeId}: could not record presence:`, error)
        return null
      })
    }

    #spawnPosition(): Point {
      const base = { x: spawn.x, y: spawn.y - FEET_OFFSET_Y }
      const first = this.state.players.size
      for (let i = 0; i < SPAWN_OFFSETS.length; i++) {
        const offset = SPAWN_OFFSETS[(first + i) % SPAWN_OFFSETS.length] ?? { x: 0, y: 0 }
        const pos = { x: base.x + offset.x, y: base.y + offset.y }
        const fits = !sweptSegmentBlocked(walkGrid, pos, pos)
        if (fits && zoneAt(map, pos.x, pos.y + FEET_OFFSET_Y)?.id === spawnZoneId) return pos
      }
      return base
    }

    #lookup(client: OfficeClient): { session: Session; player: Player } | null {
      const session = this.#sessions.get(client.sessionId)
      const player = this.state.players.get(client.sessionId)
      return session === undefined || player === undefined ? null : { session, player }
    }

    #move(client: OfficeClient, message: unknown) {
      const found = this.#lookup(client)
      const parsed = MoveMessageSchema.safeParse(message)
      if (found === null || !parsed.success) return
      const { session, player } = found
      const at = now()
      const move = parsed.data
      const allowed = takeToken(session.moves, at)
      if (allowed) this.#markActive(session, player, at)
      const verdict = allowed ? this.#checkMove(session, player, move, at) : 'speed'
      if (typeof verdict === 'string') {
        // The client snaps back to the last accepted position and stands there.
        player.moving = false
        client.send(MSG.moveReject, { x: session.pos.x, y: session.pos.y, seq: move.seq, reason: verdict })
        return
      }
      session.budget = verdict
      this.#place(session, player, { x: move.x, y: move.y }, move.dir, at)
      player.moving = move.moving
    }

    // The reject reason, or the move budget left after the move.
    #checkMove(session: Session, player: Player, move: MoveMessage, at: number): MoveRejectReason | MoveBudget {
      if (player.seatId !== '') return 'seated'
      const verdict = checkMove(walkGrid, session.pos, move, at - session.movedAt)
      if (!verdict.ok) return verdict.reason
      const budget = spendMoveBudget(session.budget, distance(session.pos.x, session.pos.y, move.x, move.y), at)
      if (budget === null) return 'speed'
      const zone = zoneAt(map, move.x, move.y + FEET_OFFSET_Y)
      if (zone !== null && zone.id !== player.zoneId) {
        const blocked = this.#entryBlock(session, zone)
        if (blocked !== null) return blocked
      }
      return budget
    }

    #entryBlock(session: Session, zone: ZoneDef) {
      let occupants = 0
      for (const player of this.state.players.values()) if (player.zoneId === zone.id) occupants++
      return zoneEntryBlock(zone, { isGuest: session.role === 'guest', guestZoneTypes: this.#guestZoneTypes, occupants })
    }

    // Moves the player to an accepted or server-chosen position and updates its zone.
    #place(session: Session, player: Player, pos: Point, dir: Facing, at: number) {
      session.pos = pos
      session.movedAt = at
      player.x = pos.x
      player.y = pos.y
      player.dir = dir
      player.moving = false
      player.zoneId = session.zones.update(pos.x, pos.y + FEET_OFFSET_Y, at).zoneId ?? ''
    }

    #markActive(session: Session, player: Player, at: number) {
      session.activeAt = at
      session.hiddenSince = null
      if (player.status !== 'available') player.status = 'available'
    }

    #activity(client: OfficeClient, message: unknown) {
      const found = this.#lookup(client)
      const parsed = PresenceActivitySchema.safeParse(message)
      if (found === null || !parsed.success) return
      const at = now()
      if (parsed.data.hidden) found.session.hiddenSince ??= at
      else this.#markActive(found.session, found.player, at)
    }

    #sit(client: OfficeClient, message: unknown, ctx: MessageContext) {
      const found = this.#lookup(client)
      const parsed = SitRequestSchema.safeParse(message)
      const seat = parsed.success ? seatDefs.get(parsed.data.seatId) : undefined
      const seatState = seat === undefined ? undefined : this.state.seats.get(seat.id)
      if (found === null || seat === undefined || seatState === undefined) return ctx.reject('invalid')
      const { session, player } = found
      const at = now()
      this.#markActive(session, player, at)
      const response: SitResponse = { ok: true, seatId: seat.id, x: seat.x, y: seat.y - FEET_OFFSET_Y, dir: seat.facing }
      if (player.seatId === seat.id) return response
      if (seatState.occupantId !== '' && seatState.occupantId !== session.userId) return ctx.reject('taken')
      const feet = feetOf(session.pos)
      const near = distance(feet.x, feet.y, seat.x, seat.y) <= SIT_RADIUS
      if (!near || !lineOfSight(wallGrid, feet.x, feet.y, seat.x, seat.y)) return ctx.reject('far')
      const zone = zoneAt(map, seat.x, seat.y)
      if (zone !== null && zone.id !== player.zoneId && this.#entryBlock(session, zone) !== null) {
        return ctx.reject('not_allowed')
      }
      if (player.seatId !== '') this.#freeSeat(player.seatId, session.userId)
      seatState.occupantId = session.userId
      player.seatId = seat.id
      this.#place(session, player, { x: response.x, y: response.y }, seat.facing, at)
      return response
    }

    #stand(client: OfficeClient, ctx: MessageContext) {
      const found = this.#lookup(client)
      if (found === null) return ctx.reject('invalid')
      const { session, player } = found
      const at = now()
      this.#markActive(session, player, at)
      const seat = seatDefs.get(player.seatId)
      if (player.seatId !== '') this.#freeSeat(player.seatId, session.userId)
      player.seatId = ''
      if (seat !== undefined) this.#place(session, player, nearestFreeStandSpot(map, walkGrid, seat), player.dir, at)
      const response: StandResponse = { ok: true, x: session.pos.x, y: session.pos.y }
      return response
    }

    #freeSeat(seatId: string, userId: string) {
      const seat = this.state.seats.get(seatId)
      if (seat !== undefined && seat.occupantId === userId) seat.occupantId = ''
    }

    #tick() {
      const at = now()
      for (const [sessionId, session] of this.#sessions) {
        const player = this.state.players.get(sessionId)
        if (player === undefined) continue
        const idle = at - session.activeAt >= AWAY_AFTER_MS
        const hidden = session.hiddenSince !== null && at - session.hiddenSince >= HIDDEN_AWAY_AFTER_MS
        const status = idle || hidden ? 'away' : 'available'
        if (player.status !== status) player.status = status
      }
      if (at - this.#accessCheckedAt >= ACCESS_RECHECK_MS && !this.#checkingAccess) {
        this.#accessCheckedAt = at
        void this.#recheckAccess()
      }
    }

    // Closes the sessions of users who lost access to the office and picks up role changes.
    async #recheckAccess() {
      this.#checkingAccess = true
      try {
        for (const session of [...this.#sessions.values()]) {
          const access = await deps.getOfficeAccess(session.userId, this.#officeId).catch((error: unknown) => {
            console.error(`OfficeRoom ${this.#officeId}: access check failed:`, error)
            return undefined
          })
          if (access === undefined || this.#sessions.get(session.sessionId) !== session) continue
          if (access === null || access.orgId !== this.#orgId) {
            this.#close(session, ROOM_CLOSE.removed)
            continue
          }
          const changed = access.role !== session.role
          session.role = access.role
          // Demoted to guest inside a zone guests may not enter: they enter the office again, at the spawn.
          if (changed && this.#forbiddenWhereItIs(session)) this.#close(session, ROOM_CLOSE.roleChanged)
        }
      } finally {
        this.#checkingAccess = false
      }
    }

    #forbiddenWhereItIs(session: Session): boolean {
      const zone = zoneAt(map, session.pos.x, session.pos.y + FEET_OFFSET_Y)
      const ctx = { isGuest: session.role === 'guest', guestZoneTypes: this.#guestZoneTypes, occupants: 0 }
      return zone !== null && zoneEntryBlock(zone, ctx) === 'guest'
    }

    // Ends a session at once: its connection closes with `code`, a pending reconnection is cancelled.
    #close(session: Session, code: number) {
      this.#remove(session)
      if (session.client !== null) session.client.leave(code)
      else session.reconnection?.reject(false)
    }

    #remove(session: Session) {
      if (this.#sessions.get(session.sessionId) !== session) return
      this.#sessions.delete(session.sessionId)
      if (this.#sessionOfUser.get(session.userId) === session.sessionId) this.#sessionOfUser.delete(session.userId)
      const player = this.state.players.get(session.sessionId)
      if (player !== undefined && player.seatId !== '') this.#freeSeat(player.seatId, session.userId)
      this.state.players.delete(session.sessionId)
      const store = deps.store
      if (store === undefined) return
      const write = session.presenceId
        .then((id) => (id === null ? undefined : store.endPresence(this.#orgId, id)))
        .catch((error: unknown) => console.error(`OfficeRoom ${this.#officeId}: could not close presence:`, error))
        .finally(() => this.#pendingWrites.delete(write))
      this.#pendingWrites.add(write)
    }
  }
}

export type OfficeRoomClass = ReturnType<typeof createOfficeRoom>
