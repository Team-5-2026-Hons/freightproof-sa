import { describe, it, expect } from 'vitest'
import { dayTile, durationLabel, groupByMonth, pastOutcome, placeOf, placeParts } from '../trip-display'
import { precinctName } from '../precinct-name'
import type { DriverTripSummary } from '@/lib/types/driver-trip'

function summary(overrides: Partial<DriverTripSummary>): DriverTripSummary {
  return {
    id: 't1' as DriverTripSummary['id'],
    trip_reference: 'TRP-2026-0035',
    status: 'closed',
    trip_type: 'loaded',
    origin_precinct_id: null,
    destination_precinct_id: null,
    origin_precinct_name: 'FedEx JHB · Linbro Park',
    destination_precinct_name: 'FedEx DBN · Riverhorse Valley',
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

describe('placeOf', () => {
  it('prefers the server-resolved name', () => {
    expect(placeOf('FedEx JHB · Linbro Park', 'any-id')).toBe('FedEx JHB · Linbro Park')
  })

  it('falls back to the local precinct lookup when the server sent no name', () => {
    expect(placeOf(null, 'some-precinct-id')).toBe(precinctName('some-precinct-id'))
  })

  it('says Unknown rather than showing nothing when there is neither', () => {
    expect(placeOf(null, null)).toBe('Unknown')
  })
})

describe('placeParts', () => {
  it('test_splits_a_precinct_name_into_place_and_area', () => {
    expect(placeParts('FedEx JHB · Linbro Park')).toEqual({ name: 'FedEx JHB', detail: 'Linbro Park' })
  })

  it('test_splits_a_name_saved_with_the_older_em_dash_separator', () => {
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

  // FP-83: the former driver did not deliver the load, whatever the trip later did.
  it('test_former_participant_on_an_active_trip_reads_handed_over', () => {
    expect(pastOutcome(summary({ status: 'active', participation: 'former', actual_arrival_at: null })))
      .toEqual({ tone: 'neutral', text: 'Handed over' })
  })

  it('test_former_participant_on_a_closed_trip_is_not_credited_with_delivery', () => {
    expect(pastOutcome(summary({ participation: 'former' })).text).toBe('Handed over')
  })

  it('test_current_participant_keeps_the_delivery_outcome', () => {
    expect(pastOutcome(summary({ participation: 'current' })).text).toBe('Delivered on time')
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
