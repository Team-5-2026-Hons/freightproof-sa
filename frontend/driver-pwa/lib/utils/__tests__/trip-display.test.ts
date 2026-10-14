import { describe, it, expect } from 'vitest'
import { dayTile, durationLabel, groupByMonth, pastOutcome, placeParts } from '../trip-display'
import type { DriverTripSummary } from '@/lib/types/driver-trip'

function summary(overrides: Partial<DriverTripSummary>): DriverTripSummary {
  return {
    id: 't1' as DriverTripSummary['id'],
    trip_reference: 'TRP-2026-0035',
    order_number: 'FX-1',
    status: 'closed',
    trip_type: 'loaded',
    origin_precinct_id: null,
    destination_precinct_id: null,
    origin_precinct_name: 'FedEx JHB — Linbro Park',
    destination_precinct_name: 'FedEx DBN — Riverhorse Valley',
    planned_departure_at: '2026-05-03T09:00:00Z',
    actual_departure_at: '2026-05-03T09:00:00Z',
    planned_arrival_at: '2026-05-03T19:30:00Z',
    actual_arrival_at: '2026-05-03T19:30:00Z',
    needs_review_count: 0,
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-03T20:00:00Z',
    ...overrides,
  }
}

describe('placeParts', () => {
  it('test_splits_a_precinct_name_into_place_and_area', () => {
    expect(placeParts('FedEx JHB — Linbro Park')).toEqual({ name: 'FedEx JHB', detail: 'Linbro Park' })
  })

  it('test_keeps_a_name_without_an_area_whole', () => {
    expect(placeParts('Depot 4')).toEqual({ name: 'Depot 4', detail: null })
  })
})

describe('durationLabel', () => {
  it('test_formats_hours_and_zero_padded_minutes', () => {
    expect(durationLabel('2026-05-03T09:00:00Z', '2026-05-03T19:45:00Z')).toBe('10 h 45')
  })

  it('test_is_null_without_both_ends', () => {
    expect(durationLabel(null, '2026-05-03T19:45:00Z')).toBeNull()
  })
})

describe('pastOutcome', () => {
  it('test_on_time_delivery_is_success', () => {
    expect(pastOutcome(summary({}))).toEqual({ tone: 'success', text: 'Delivered on time' })
  })

  it('test_late_delivery_says_how_late_in_neutral_not_red', () => {
    const late = summary({ actual_arrival_at: '2026-05-03T19:55:00Z' })

    expect(pastOutcome(late)).toEqual({ tone: 'neutral', text: 'Delivered · 25 min late' })
  })

  it('test_open_review_outranks_timeliness', () => {
    expect(pastOutcome(summary({ needs_review_count: 2 }))).toEqual({ tone: 'attention', text: 'Under review · 2 exceptions' })
    expect(pastOutcome(summary({ needs_review_count: 1 })).text).toBe('Under review · 1 exception')
  })

  it('test_cancelled_trip_says_so', () => {
    expect(pastOutcome(summary({ status: 'cancelled' }))).toEqual({ tone: 'neutral', text: 'Cancelled' })
  })

  it('test_missing_times_still_read_as_delivered', () => {
    expect(pastOutcome(summary({ actual_arrival_at: null })).text).toBe('Delivered')
  })
})

describe('dayTile', () => {
  it('test_gives_weekday_and_day_of_month', () => {
    expect(dayTile('2026-05-09T08:00:00Z')).toEqual({ weekday: 'SAT', day: '9' })
  })

  it('test_is_null_for_an_unscheduled_trip', () => {
    expect(dayTile(null)).toBeNull()
  })
})

describe('groupByMonth', () => {
  it('test_groups_trips_under_their_departure_month_keeping_order', () => {
    const may2 = summary({ id: 'a' as DriverTripSummary['id'], planned_departure_at: '2026-05-20T08:00:00Z' })
    const may1 = summary({ id: 'b' as DriverTripSummary['id'], planned_departure_at: '2026-05-03T08:00:00Z' })
    const apr = summary({ id: 'c' as DriverTripSummary['id'], planned_departure_at: '2026-04-29T08:00:00Z' })

    const groups = groupByMonth([may2, may1, apr])

    expect(groups.map((g) => g.label)).toEqual(['May 2026', 'April 2026'])
    expect(groups[0].trips.map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('test_puts_unscheduled_trips_in_their_own_group_last', () => {
    const groups = groupByMonth([summary({ planned_departure_at: null, actual_departure_at: null })])

    expect(groups[0].label).toBe('Unscheduled')
  })
})
