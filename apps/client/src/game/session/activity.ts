import { ACTIVITY_REPORT_INTERVAL_MS, type PresenceActivity } from '@vo/shared'

// presence:activity. Input reports go out at most every intervalMs; a visibility change goes out at once.
// The join itself counts as activity, so the first input report waits a full interval.
export class ActivityReporter {
  private readonly send: (activity: PresenceActivity) => void
  private readonly now: () => number
  private readonly intervalMs: number
  private lastSentAt: number

  constructor(send: (activity: PresenceActivity) => void, now: () => number, intervalMs = ACTIVITY_REPORT_INTERVAL_MS) {
    this.send = send
    this.now = now
    this.intervalMs = intervalMs
    this.lastSentAt = now()
  }

  input(): void {
    const now = this.now()
    if (now - this.lastSentAt < this.intervalMs) return
    this.lastSentAt = now
    this.send({ hidden: false })
  }

  visibility(hidden: boolean): void {
    this.lastSentAt = this.now()
    this.send({ hidden })
  }
}
