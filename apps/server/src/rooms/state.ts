import { schema, t, type SchemaType } from '@colyseus/schema'
import type { Facing, PlayerState, PlayerStatus, SeatState } from '@vo/shared'

// Schema 5 builder syntax (no decorators). Fields match PlayerState / SeatState in @vo/shared.
export const Player = schema(
  {
    userId: t.string(),
    name: t.string(),
    color: t.string(),
    x: t.float32(),
    y: t.float32(),
    dir: t.string<Facing>().default('down'),
    moving: t.boolean().default(false),
    zoneId: t.string().default(''),
    seatId: t.string().default(''),
    status: t.string<PlayerStatus>().default('available'),
  },
  'Player',
)
export type Player = SchemaType<typeof Player>

export const Seat = schema({ occupantId: t.string().default('') }, 'Seat')
export type Seat = SchemaType<typeof Seat>

export const OfficeState = schema(
  {
    players: t.map(Player),
    seats: t.map(Seat),
  },
  'OfficeState',
)
export type OfficeState = SchemaType<typeof OfficeState>

// Compile-time check that the synced state is what the client reads.
type Assert<T extends true> = T
export type PlayerMatchesContract = Assert<Player extends PlayerState ? true : false>
export type SeatMatchesContract = Assert<Seat extends SeatState ? true : false>
