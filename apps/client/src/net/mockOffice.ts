import {
  avatarColor,
  buildGrid,
  effectiveStatus,
  FEET_OFFSET_Y,
  MAX_SPEED,
  mentionToken,
  parseMentions,
  PATCH_RATE_MS,
  parseOfficeMap,
  ROOM_CLOSE,
  SIT_RADIUS,
  StatusTextSchema,
  ZoneTracker,
  lineOfSight,
  type ChatDeleted,
  type ChatMessage,
  type ChatMuted,
  type ChosenStatus,
  type Facing,
  type Grid,
  type MoveReject,
  type OfficeMap,
  type OrgRole,
  type PlayerState,
  type SeatState,
  type WaveReceived,
} from '@vo/shared'
import type { OfficeApi } from '../office/officeApi.ts'
import { MOCK_LINES, MOCK_OWN, mockChatServer, type MockChatServer } from './mockChat.ts'
import type { JoinOffice, OfficeConnectionHandle, OfficeLink, Unsubscribe } from './officeLink.ts'

// DEV ONLY: a stand-in for the office server, so the office renders without accounts or a running server
// (route /dev/office). It accepts moves along clear lines, computes zones, handles seats, walks two bots and runs
// the chat, status, waves, blocks and moderation in memory (mockChat.ts). Bots answer a mention and wave back.
// window.__voMock: close(code) simulates a server close (4100 replaced, 4101 removed, 4102 role changed, 4103 kicked,
// 4001 shutdown), drop() a dropped connection, rejectTo(x, y) a move:reject that snaps the own avatar to (x, y),
// say(name, text) a chat message from a bot, mentionMe(name) a bot mentioning you, wave(name) a wave from a bot,
// muteMe(minutes) mutes you (0 unmutes).

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

function rejected(reason: string): Error {
  return Object.assign(new Error(reason), { name: 'rejected', reason })
}

// A little network delay for requests.
const answer = <T>(value: () => T, ms = 120): Promise<T> =>
  new Promise((resolve, reject) =>
    window.setTimeout(() => {
      try {
        resolve(value())
      } catch (error) {
        reject(error)
      }
    }, ms),
  )

class MockOffice {
  private readonly chat: MockChatServer
  private readonly chosen = new Map<string, ChosenStatus>()
  private readonly away = new Set<string>()
  private readonly chatNew = new Signal<[ChatMessage]>()
  private readonly chatDeleted = new Signal<[ChatDeleted]>()
  private readonly chatMuted = new Signal<[ChatMuted]>()
  private readonly waves = new Signal<[WaveReceived]>()
  private readonly timers = new Set<number>()
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

  constructor(map: OfficeMap, chat: MockChatServer) {
    this.chat = chat
    this.map = map
    this.grid = buildGrid(map, ['wall', 'furniture'])
    for (const seat of map.seats) this.seats.set(seat.id, { occupantId: '' })
    const spawn = map.spawns.find((s) => s.id === 'main') ?? { x: map.widthPx / 2, y: map.heightPx / 2 }
    const own = this.addPlayer(OWN_SESSION, MOCK_OWN.userId, MOCK_OWN.name, spawn.x, spawn.y - FEET_OFFSET_Y)
    own.statusText = chat.statusText
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
    this.away.add('mock-bot-grace')
    this.chosen.set('mock-bot-linus', 'busy')
    const linus = this.players.get('mock-bot-linus')
    if (linus) linus.statusText = 'Heads down until 3pm'
    const ada = this.players.get('mock-bot-ada')
    if (ada) ada.statusText = 'Ask me about the roadmap'
    for (const sessionId of this.players.keys()) this.refreshStatus(sessionId)
    this.timer = window.setInterval(() => this.tick(), PATCH_RATE_MS)
    this.later(() => this.botChatter(), 45_000)
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
      sendActivity: ({ hidden }) => {
        if (hidden) this.away.add(OWN_SESSION)
        else this.away.delete(OWN_SESSION)
        this.refreshStatus(OWN_SESSION)
      },
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
      sendChat: (request) =>
        answer(() => {
          const result = this.chat.send(MOCK_OWN.userId, this.own.name, request.clientMsgId, request.body, Date.now())
          if (!result.ok) throw rejected(result.reason)
          if (result.created) this.botsAnswer(result.message)
          return result.message
        }),
      deleteChat: (id) =>
        answer(() => {
          const result = this.chat.delete(MOCK_OWN.userId, id, Date.now())
          if (result !== 'ok') throw rejected(result)
          this.chatDeleted.emit({ id })
        }),
      markChatRead: (lastReadId) => {
        this.chat.markRead(lastReadId)
        return true
      },
      onChatNew: (handler) => this.chatNew.on(handler),
      onChatDeleted: (handler) => this.chatDeleted.on(handler),
      onChatMuted: (handler) => this.chatMuted.on(handler),
      setStatus: (request) =>
        answer(() => {
          const parsed = StatusTextSchema.safeParse(request.statusText ?? this.own.statusText)
          if (!parsed.success) throw rejected('invalid')
          const text = parsed.data
          this.chosen.set(OWN_SESSION, request.status)
          this.chat.setStatusText(text)
          this.update(this.own, { statusText: text })
          this.refreshStatus(OWN_SESSION)
          return { ok: true as const, status: request.status, statusText: text }
        }),
      wave: (targetUserId) => this.waveAtBot(targetUserId),
      onWaveReceived: (handler) => this.waves.on(handler),
      setBlocked: (userId, blocked) =>
        answer(() => {
          const result = this.chat.setBlocked(userId, blocked)
          if (!result.ok) throw rejected(result.reason)
          return result.blockedUserIds
        }),
      mute: (userId, minutes) =>
        answer(() => {
          const result = this.chat.mute(MOCK_OWN.userId, userId, minutes, Date.now())
          if (!result.ok) throw rejected(result.reason)
          return result.until
        }),
      kick: (userId) =>
        answer(() => {
          const entry = [...this.players].find(([, p]) => p.userId === userId)
          if (!entry) throw rejected('not_found')
          if (!this.chat.moderates(MOCK_OWN.userId, userId)) throw rejected('not_allowed')
          this.removePlayer(entry[0])
        }),
      // The mock never changes the own role.
      onRoleChanged: () => () => undefined,
    }
    Object.assign(window, {
      __voMock: {
        close: (code: number = ROOM_CLOSE.replaced) => this.close(code),
        drop: () => this.drop(),
        rejectTo: (x: number, y: number) => {
          this.update(this.own, { x, y, moving: false })
          this.rejects.emit({ x, y, seq: this.lastSeq, reason: 'collision' })
        },
        say: (name: string, text: string) => this.botSays(name, text),
        mentionMe: (name = 'Ada') => this.botSays(name, `${mentionToken(MOCK_OWN.userId)} got a minute?`),
        wave: (name = 'Ada') => {
          const bot = this.botNamed(name)
          if (bot && this.chosen.get(OWN_SESSION) !== 'dnd' && !this.chat.blocked.includes(bot.userId)) {
            this.waves.emit({ fromUserId: bot.userId, fromName: bot.name })
          }
        },
        muteMe: (minutes = 15) => this.chatMuted.emit({ until: this.chat.muteOwn(minutes, Date.now()) }),
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

  private removePlayer(sessionId: string): void {
    const player = this.players.get(sessionId)
    if (!player) return
    this.unseat(player)
    this.players.delete(sessionId)
    this.removed.emit(player, sessionId)
  }

  private refreshStatus(sessionId: string): void {
    const player = this.players.get(sessionId)
    if (!player) return
    const chosen = this.chosen.get(sessionId) ?? 'available'
    const inRoomZone = this.map.zones.find((zone) => zone.id === player.zoneId)?.mediaMode === 'room'
    const status = effectiveStatus({ chosen, away: this.away.has(sessionId), inRoomZone })
    if (status !== player.status || chosen !== player.chosenStatus) this.update(player, { status, chosenStatus: chosen })
  }

  private later(run: () => void, ms: number): void {
    const timer = window.setTimeout(() => {
      this.timers.delete(timer)
      run()
    }, ms)
    this.timers.add(timer)
  }

  private botNamed(name: string): PlayerState | undefined {
    return [...this.players.values()].find((p) => p.name.toLowerCase() === name.toLowerCase() && p.userId !== MOCK_OWN.userId)
  }

  private botSays(name: string, text: string): void {
    const bot = this.botNamed(name)
    if (!bot) return
    const result = this.chat.send(bot.userId, bot.name, crypto.randomUUID(), text, Date.now())
    if (result.ok && result.created) this.chatNew.emit(result.message)
  }

  // A mentioned bot in the room answers with a mention of you.
  private botsAnswer(message: ChatMessage): void {
    const { userIds } = parseMentions(message.body)
    for (const player of this.players.values()) {
      if (!userIds.includes(player.userId) || player.userId === MOCK_OWN.userId) continue
      this.later(() => this.botSays(player.name, `${mentionToken(MOCK_OWN.userId)} on it!`), 1200)
    }
  }

  private waveAtBot(targetUserId: string): void {
    const bot = [...this.players.values()].find((p) => p.userId === targetUserId)
    if (!bot || bot.userId === MOCK_OWN.userId || bot.status === 'dnd' || this.chat.blocked.includes(bot.userId)) return
    this.later(() => {
      if (this.chosen.get(OWN_SESSION) !== 'dnd') this.waves.emit({ fromUserId: bot.userId, fromName: bot.name })
    }, 1000)
  }

  private botChatter(): void {
    const bots = [...this.players.values()].filter((p) => p.userId !== MOCK_OWN.userId)
    const bot = bots[Math.floor(Math.random() * bots.length)]
    if (bot) this.botSays(bot.name, MOCK_LINES[Math.floor(Math.random() * MOCK_LINES.length)] ?? 'Hello')
    this.later(() => this.botChatter(), 40_000 + Math.random() * 30_000)
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
    this.update(own, { x, y, dir, moving, zoneId })
    this.away.delete(OWN_SESSION)
    this.refreshStatus(OWN_SESSION)
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
      this.refreshStatus(bot.sessionId)
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
    for (const timer of this.timers) window.clearTimeout(timer)
    this.timers.clear()
    this.left.emit(code)
  }
}

// The mock office for one own role (the first call picks it): the room join and the HTTP side.
export function mockOffice(role: OrgRole): { join: JoinOffice; api: OfficeApi } {
  const chat = mockChatServer(role)
  return {
    join: async () => {
      const response = await fetch(MAP_URL)
      return new MockOffice(parseOfficeMap(await response.json()), chat).handle()
    },
    api: chat.api(),
  }
}
