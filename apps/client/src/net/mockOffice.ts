import {
  avatarColor,
  buildGrid,
  FEET_OFFSET_Y,
  MAX_SPEED,
  PATCH_RATE_MS,
  parseOfficeMap,
  ROOM_CLOSE,
  SIT_RADIUS,
  ZoneTracker,
  lineOfSight,
  type Facing,
  type Grid,
  type MoveReject,
  type OfficeMap,
  type PlayerState,
  type SeatState,
  type SitRejectReason,
} from '@vo/shared'
import type { JoinOffice, OfficeConnectionHandle, OfficeLink, Unsubscribe } from './officeLink.ts'

// DEV ONLY: a stand-in for the office server, so the office renders without accounts or a running server
// (route /dev/office). It accepts moves along clear lines, computes zones, handles seats and walks two bots.
// window.__voMock: close(code) simulates a server close (4100 replaced, 4101 removed, 4102 role changed, 4001 shutdown), drop() a
// dropped connection, rejectTo(x, y) a move:reject that snaps the own avatar to (x, y).

type MutablePlayer = { -readonly [K in keyof PlayerState]: PlayerState[K] }
type MutableSeat = { -readonly [K in keyof SeatState]: SeatState[K] }

const MAP_URL = `${import.meta.env.BASE_URL}assets/map/map.json`
const OWN_SESSION = 'mock-own'
const BOT_SPEED = MAX_SPEED * 0.6

interface Bot {
  sessionId: string
  path: Array<[number, number]>
  next: number
}

class Signal<A extends unknown[]> {
  private readonly handlers = new Set<(...args: A) => void>()
  on(handler: (...args: A) => void): Unsubscribe {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }
  emit(...args: A): void {
    for (const handler of [...this.handlers]) handler(...args)
  }
}

function rejected(reason: SitRejectReason): Error {
  return Object.assign(new Error(reason), { name: 'rejected', reason })
}

class MockOffice {
  private readonly map: OfficeMap
  private readonly grid: Grid
  private readonly players = new Map<string, MutablePlayer>()
  private readonly seats = new Map<string, MutableSeat>()
  private readonly trackers = new Map<string, ZoneTracker>()
  private readonly changeHandlers = new Map<PlayerState, Signal<[]>>()
  private readonly dirty = new Set<PlayerState>()
  private readonly added = new Signal<[PlayerState, string]>()
  private readonly removed = new Signal<[PlayerState, string]>()
  private readonly rejects = new Signal<[MoveReject]>()
  private readonly dropped = new Signal<[]>()
  private readonly reconnected = new Signal<[]>()
  private readonly left = new Signal<[number]>()
  private readonly bots: Bot[] = []
  private timer: number | undefined
  private lastSeq = 0

  constructor(map: OfficeMap) {
    this.map = map
    this.grid = buildGrid(map, ['wall', 'furniture'])
    for (const seat of map.seats) this.seats.set(seat.id, { occupantId: '' })
    const spawn = map.spawns.find((s) => s.id === 'main') ?? { x: map.widthPx / 2, y: map.heightPx / 2 }
    this.addPlayer(OWN_SESSION, 'mock-user-own', 'You (mock)', spawn.x, spawn.y - FEET_OFFSET_Y)
    this.addBot('mock-bot-ada', 'Ada', [
      [300, 360],
      [700, 360],
      [700, 400],
      [300, 400],
    ])
    this.addBot('mock-bot-linus', 'Linus', [
      [704, 450],
      [704, 880],
    ])
    const grace = this.addPlayer('mock-bot-grace', 'mock-user-grace', 'Grace', 0, 0)
    const seat = map.seats.find((s) => s.hasComputer)
    if (seat) this.seatPlayer(grace, seat.id)
    grace.status = 'away'
    this.timer = window.setInterval(() => this.tick(), PATCH_RATE_MS)
  }

  handle(): OfficeConnectionHandle {
    const link: OfficeLink = {
      sessionId: OWN_SESSION,
      state: { players: this.players, seats: this.seats },
      onPlayerAdd: (handler) => {
        for (const [sessionId, player] of this.players) handler(player, sessionId)
        return this.added.on(handler)
      },
      onPlayerRemove: (handler) => this.removed.on(handler),
      onPlayerChange: (player, handler) => this.signalFor(player).on(handler),
      onMoveReject: (handler) => this.rejects.on(handler),
      sendMove: (move) => this.move(move.x, move.y, move.dir, move.moving, move.seq),
      sendActivity: ({ hidden }) => this.update(this.own, { status: hidden ? 'away' : 'available' }),
      sit: async (seatId) => {
        const seat = this.map.seats.find((s) => s.id === seatId)
        if (!seat) throw rejected('invalid')
        if (this.seats.get(seatId)?.occupantId) throw rejected('taken')
        if (Math.hypot(seat.x - this.own.x, seat.y - (this.own.y + FEET_OFFSET_Y)) > SIT_RADIUS) throw rejected('far')
        this.seatPlayer(this.own, seatId)
        return { ok: true as const, seatId, x: this.own.x, y: this.own.y, dir: this.own.dir }
      },
      stand: async () => {
        this.unseat(this.own)
        return { ok: true as const, x: this.own.x, y: this.own.y }
      },
    }
    Object.assign(window, {
      __voMock: {
        close: (code: number = ROOM_CLOSE.replaced) => this.close(code),
        drop: () => this.drop(),
        rejectTo: (x: number, y: number) => {
          this.update(this.own, { x, y, moving: false })
          this.rejects.emit({ x, y, seq: this.lastSeq, reason: 'collision' })
        },
      },
    })
    return {
      link,
      onDrop: (handler) => this.dropped.on(handler),
      onReconnect: (handler) => this.reconnected.on(handler),
      onLeave: (handler) => this.left.on(handler),
      leave: async () => this.close(4000),
    }
  }

  private get own(): MutablePlayer {
    return this.players.get(OWN_SESSION) as MutablePlayer
  }

  private addPlayer(sessionId: string, userId: string, name: string, x: number, y: number): MutablePlayer {
    const player: MutablePlayer = {
      userId,
      name,
      color: avatarColor(userId),
      x,
      y,
      dir: 'down',
      moving: false,
      zoneId: '',
      seatId: '',
      status: 'available',
      chosenStatus: 'available',
      statusText: '',
    }
    this.players.set(sessionId, player)
    const tracker = new ZoneTracker(this.map, { dwellMs: 0 })
    this.trackers.set(sessionId, tracker)
    player.zoneId = tracker.update(x, y + FEET_OFFSET_Y, 0).zoneId ?? ''
    this.added.emit(player, sessionId)
    return player
  }

  private addBot(sessionId: string, name: string, path: Array<[number, number]>): void {
    const [x, y] = path[0] as [number, number]
    this.addPlayer(sessionId, `mock-user-${name.toLowerCase()}`, name, x, y)
    this.bots.push({ sessionId, path, next: 1 })
  }

  private signalFor(player: PlayerState): Signal<[]> {
    let signal = this.changeHandlers.get(player)
    if (!signal) this.changeHandlers.set(player, (signal = new Signal()))
    return signal
  }

  private update(player: MutablePlayer, fields: Partial<MutablePlayer>): void {
    Object.assign(player, fields)
    this.dirty.add(player)
  }

  private move(x: number, y: number, dir: Facing, moving: boolean, seq: number): void {
    const own = this.own
    this.lastSeq = seq
    const reject = (reason: MoveReject['reason']) =>
      window.setTimeout(() => this.rejects.emit({ x: own.x, y: own.y, seq, reason }), 40)
    if (own.seatId) return void reject('seated')
    const inside = x >= 0 && y + FEET_OFFSET_Y >= 0 && x < this.map.widthPx && y + FEET_OFFSET_Y < this.map.heightPx
    if (!inside || !lineOfSight(this.grid, own.x, own.y + FEET_OFFSET_Y, x, y + FEET_OFFSET_Y)) return void reject('collision')
    const zoneId = this.trackers.get(OWN_SESSION)?.update(x, y + FEET_OFFSET_Y, performance.now()).zoneId ?? ''
    this.update(own, { x, y, dir, moving, zoneId, status: 'available' })
  }

  private seatPlayer(player: MutablePlayer, seatId: string): void {
    const seat = this.map.seats.find((s) => s.id === seatId)
    const state = this.seats.get(seatId)
    if (!seat || !state) return
    state.occupantId = player.userId
    this.update(player, { x: seat.x, y: seat.y - FEET_OFFSET_Y, dir: seat.facing, moving: false, seatId, zoneId: seat.zoneId })
  }

  private unseat(player: MutablePlayer): void {
    const state = this.seats.get(player.seatId)
    if (state) state.occupantId = ''
    this.update(player, { seatId: '' })
  }

  private tick(): void {
    const step = (BOT_SPEED * PATCH_RATE_MS) / 1000
    for (const bot of this.bots) {
      const player = this.players.get(bot.sessionId)
      const [tx, ty] = bot.path[bot.next] as [number, number]
      if (!player) continue
      const dx = tx - player.x
      const dy = ty - player.y
      const d = Math.hypot(dx, dy)
      if (d <= step) bot.next = (bot.next + 1) % bot.path.length
      const k = Math.min(1, step / (d || 1))
      const dir: Facing = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down'
      const x = player.x + dx * k
      const y = player.y + dy * k
      const zoneId = this.trackers.get(bot.sessionId)?.update(x, y + FEET_OFFSET_Y, performance.now()).zoneId ?? ''
      this.update(player, { x, y, dir, moving: true, zoneId })
    }
    for (const player of [...this.dirty]) this.changeHandlers.get(player)?.emit()
    this.dirty.clear()
  }

  private drop(): void {
    this.dropped.emit()
    window.setTimeout(() => this.reconnected.emit(), 1500)
  }

  private close(code: number): void {
    window.clearInterval(this.timer)
    this.timer = undefined
    this.left.emit(code)
  }
}

export const joinMockOffice: JoinOffice = async () => {
  const response = await fetch(MAP_URL)
  return new MockOffice(parseOfficeMap(await response.json())).handle()
}
