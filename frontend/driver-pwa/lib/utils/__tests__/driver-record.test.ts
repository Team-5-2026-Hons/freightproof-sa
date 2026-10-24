import { describe, it, expect } from 'vitest'
import type { DriverTripSummary } from '@/lib/types/driver-trip'
import { driverRecord } from '@/lib/utils/driver-record'

// Only the fields driverRecord reads; the cast keeps fixtures readable.
function trip(fields: Partial<DriverTripSummary>): DriverTripSummary {
  return {
    id: crypto.randomUUID(),
    status: 'closed',
    planned_arrival_at: null,
    actual_arrival_at: null,
    needs_review_count: 0,
    ...fields,
  } as DriverTripSummary
}

describe('driverRecord', () => {
  it('test_counts_only_closed_trips_as_completed', () => {
    const record = driverRecord([trip({}), trip({}), trip({ status: 'cancelled' }), trip({ status: 'active' })])

    expect(record.completed).toBe(2)
  })

  it('test_on_time_rate_compares_actual_to_planned_arrival', () => {
    // Arrange — one early, one exactly on plan, one late.
    const trips = [
      trip({ planned_arrival_at: '2026-10-01T12:00:00Z', actual_arrival_at: '2026-10-01T11:40:00Z' }),
      trip({ planned_arrival_at: '2026-10-02T12:00:00Z', actual_arrival_at: '2026-10-02T12:00:00Z' }),
      trip({ planned_arrival_at: '2026-10-03T12:00:00Z', actual_arrival_at: '2026-10-03T12:30:00Z' }),
    ]

    // Act
    const record = driverRecord(trips)

    // Assert
    expect(record.onTimeRate).toBeCloseTo(2 / 3)
  })

  it('test_on_time_rate_is_null_when_no_trip_can_be_judged', () => {
    const record = driverRecord([trip({ actual_arrival_at: '2026-10-01T11:40:00Z' }), trip({ status: 'active' })])

    expect(record.onTimeRate).toBeNull()
  })

  it('test_cancelled_trips_never_affect_the_on_time_rate', () => {
    const record = driverRecord([
      trip({ planned_arrival_at: '2026-10-01T12:00:00Z', actual_arrival_at: '2026-10-01T11:00:00Z' }),
      trip({ status: 'cancelled', planned_arrival_at: '2026-10-02T12:00:00Z', actual_arrival_at: '2026-10-02T15:00:00Z' }),
    ])

    expect(record.onTimeRate).toBe(1)
  })

  it('test_under_review_sums_every_trip', () => {
    const record = driverRecord([trip({ needs_review_count: 1 }), trip({ status: 'active', needs_review_count: 2 })])

    expect(record.underReview).toBe(3)
  })

  it('test_empty_history_is_all_zero_with_no_rate', () => {
    expect(driverRecord([])).toEqual({ completed: 0, onTimeRate: null, underReview: 0 })
  })
})
