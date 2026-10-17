import { SIT_RADIUS, type Point, type SeatDef, type SitRejectReason } from '@vo/shared'

// The closest free seat whose point is within `radius` of the feet point.
export function nearestFreeSeat(
  seats: readonly SeatDef[],
  feet: Point,
  isFree: (seatId: string) => boolean,
  radius: number = SIT_RADIUS,
): SeatDef | null {
  let best: SeatDef | null = null
  let bestDistance = radius
  for (const seat of seats) {
    const d = Math.hypot(seat.x - feet.x, seat.y - feet.y)
    if (d <= bestDistance && isFree(seat.id)) {
      best = seat
      bestDistance = d
    }
  }
  return best
}

export function seatHint(seated: boolean, nearby: SeatDef | null): string | null {
  if (seated) return 'E: stand'
  if (!nearby) return null
  return nearby.hasComputer ? 'E: sit (computer)' : 'E: sit'
}

const SIT_REJECT_TEXT: Record<SitRejectReason, string> = {
  taken: 'Someone else is sitting there.',
  far: 'Walk a little closer to the seat.',
  not_allowed: 'You cannot sit there.',
  invalid: 'That seat is not available.',
}

export function sitRejectText(reason: string | null): string {
  return reason !== null && Object.hasOwn(SIT_REJECT_TEXT, reason)
    ? SIT_REJECT_TEXT[reason as SitRejectReason]
    : 'Could not sit down. Try again.'
}
