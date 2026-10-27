import { describe, expect, it } from 'vitest'
import type { Trip } from '@shared/lib/types/trip'
import type { TripException } from '@shared/lib/types/exception'
import { openDriverExceptions, tripNeedsAttention } from '@/lib/utils/trip-attention'

function trip(status: Trip['status']): Trip {
  return { id: crypto.randomUUID(), status } as Trip
}

function exception(fields: Pick<TripException, 'review_status' | 'source'> & Partial<Pick<TripException, 'exception_type'>>): TripException {
  return { id: crypto.randomUUID(), ...fields } as TripException
}

describe('openDriverExceptions', () => {
  it('keeps unreviewed driver and dispatcher exceptions', () => {
    const list = [
      exception({ review_status: 'recorded', source: 'driver' }),
      exception({ review_status: 'needs_review', source: 'dispatcher' }),
    ]

    const open = openDriverExceptions(list)

    expect(open).toHaveLength(2)
  })

  it('drops reviewed exceptions and system detections', () => {
    const list = [
      exception({ review_status: 'reviewed', source: 'driver' }),
      exception({ review_status: 'needs_review', source: 'system' }),
    ]

    const open = openDriverExceptions(list)

    expect(open).toEqual([])
  })
})

describe('tripNeedsAttention', () => {
  it('is false with no trip', () => {
    expect(tripNeedsAttention(null, [])).toBe(false)
  })

  it('is false for an ordinary active trip with nothing open', () => {
    expect(tripNeedsAttention(trip('active'), [])).toBe(false)
  })

  it('is true when the trip is on an exception hold', () => {
    expect(tripNeedsAttention(trip('exception_hold'), [])).toBe(true)
  })

  it('is true when an open driver-visible exception exists', () => {
    const list = [exception({ review_status: 'recorded', source: 'driver' })]

    const result = tripNeedsAttention(trip('active'), list)

    expect(result).toBe(true)
  })

  it('ignores a system detection on an otherwise ordinary trip', () => {
    const list = [exception({ review_status: 'needs_review', source: 'system' })]

    const result = tripNeedsAttention(trip('active'), list)

    expect(result).toBe(false)
  })

  it('ignores a dispatcher note — shown on Home, but never badged', () => {
    const list = [exception({ review_status: 'needs_review', source: 'dispatcher', exception_type: 'dispatcher_note' })]

    const result = tripNeedsAttention(trip('active'), list)

    expect(result).toBe(false)
  })
})
