import { describe, expect, it } from 'vitest'
import { ACTIVITY_REPORT_INTERVAL_MS, type PresenceActivity } from '@vo/shared'
import { ActivityReporter } from './activity.ts'

describe('ActivityReporter', () => {
  it('throttles input reports and sends visibility changes at once', () => {
    let now = 0
    const sent: PresenceActivity[] = []
    const reporter = new ActivityReporter((a) => sent.push(a), () => now)
    reporter.input()
    expect(sent).toEqual([])
    now = ACTIVITY_REPORT_INTERVAL_MS
    reporter.input()
    reporter.input()
    expect(sent).toEqual([{ hidden: false }])
    now += 10
    reporter.visibility(true)
    reporter.visibility(false)
    expect(sent).toEqual([{ hidden: false }, { hidden: true }, { hidden: false }])
    now += ACTIVITY_REPORT_INTERVAL_MS - 1
    reporter.input()
    expect(sent).toHaveLength(3)
  })
})
