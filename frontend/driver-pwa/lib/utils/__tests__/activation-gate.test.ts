// Edge cases of the pure activation rules. The screen-level behaviour lives in
// app/(app)/trips/detail/__tests__ — this file covers the boundaries that are awkward to
// reach through the UI: the operating-day cutover, and a trip with no schedule at all.
import { describe, it, expect } from 'vitest'
import { activationBlock, operatingDay, isBeforeScheduledDay } from '../activation-gate'
import type { ActivationCandidate } from '../activation-gate'

function trip(
  id: string,
  status: ActivationCandidate['status'],
  planned_departure_at: string | null,
): ActivationCandidate {
  return { id, trip_reference: `REF-${id}`, status, planned_departure_at }
}

describe('operatingDay', () => {
  it('rolls over at midnight in the operator timezone, not at UTC midnight', () => {
    expect(operatingDay(new Date('2026-08-05T22:30:00Z'))).toBe('2026-08-06')
    expect(operatingDay(new Date('2026-08-05T21:30:00Z'))).toBe('2026-08-05')
  })
})

describe('isBeforeScheduledDay', () => {
  it('allows any time on the scheduled day, however early', () => {
    const now = new Date('2026-08-05T00:00:00Z')
    const scheduled = new Date('2026-08-05T06:00:00Z')

    expect(isBeforeScheduledDay(now, scheduled)).toBe(false)
  })

  it('never blocks a late start', () => {
    const now = new Date('2026-08-09T08:00:00Z')
    const scheduled = new Date('2026-08-05T06:00:00Z')

    expect(isBeforeScheduledDay(now, scheduled)).toBe(false)
  })
})

describe('activationBlock', () => {
  const NOW = new Date('2026-08-05T08:00:00Z')

  it('does not gate a trip that is already underway', () => {
    const self = trip('a', 'active', '2026-08-06T06:00:00Z')

    expect(activationBlock(self, [self], NOW)).toBeNull()
  })

  it('does not gate a finished trip', () => {
    const self = trip('a', 'closed', '2026-08-06T06:00:00Z')

    expect(activationBlock(self, [self], NOW)).toBeNull()
  })

  it('stays silent on a trip with no planned departure', () => {
    const self = trip('a', 'created', null)

    expect(activationBlock(self, [self], NOW)).toBeNull()
  })

  it('reports an underway trip ahead of a date problem', () => {
    const self = trip('a', 'created', '2026-08-09T06:00:00Z')
    const other = trip('b', 'active', '2026-08-05T06:00:00Z')

    expect(activationBlock(self, [self, other], NOW)?.reason).toBe('other_trip_underway')
  })

  it('ignores a same-day sibling that departs later', () => {
    const self = trip('a', 'created', '2026-08-05T06:00:00Z')
    const later = trip('b', 'created', '2026-08-05T14:00:00Z')

    expect(activationBlock(self, [self, later], NOW)).toBeNull()
  })

  it('ignores an earlier sibling on a different operating day', () => {
    const self = trip('a', 'created', '2026-08-05T06:00:00Z')
    const lastWeek = trip('b', 'created', '2026-07-29T03:00:00Z')

    expect(activationBlock(self, [self, lastWeek], NOW)).toBeNull()
  })

  it('names the earliest blocking sibling when several depart before it', () => {
    const self = trip('a', 'created', '2026-08-05T14:00:00Z')
    const mid = trip('b', 'created', '2026-08-05T09:00:00Z')
    const first = trip('c', 'created', '2026-08-05T03:00:00Z')

    const block = activationBlock(self, [self, mid, first], NOW)

    expect(block?.reason).toBe('earlier_trip_first')
    expect(block?.blockingTripReference).toBe('REF-c')
  })
})
