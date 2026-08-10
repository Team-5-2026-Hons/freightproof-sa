import { describe, it, expect } from 'vitest'
import { tripsForDriver, categorizeTrips, filterPastTrips, sortByDeparture } from '../trip-filters'
import type { Trip, TripId } from '@shared/lib/types/trip'
import type { DriverId } from '@shared/lib/types/driver'

const driverA = 'driver-a' as DriverId
const driverB = 'driver-b' as DriverId

function makeTrip(overrides: Partial<Trip>): Trip {
  return {
    id: 'trip-1' as TripId,
    trip_reference: 'TRP-TEST-0001',
    order_number: 'ORD-0001',
    status: 'created',
    trip_type: 'loaded',
    journey_lock_hash: null,
    idvs_check_status: 'pending',
    origin_precinct_id: 'origin-1',
    destination_precinct_id: 'dest-1',
    stops: [],
    consignments: [],
    pulsit_trip_reference_id: null,
    planned_departure_at: '2026-06-20T08:00:00Z',
    actual_departure_at: null,
    planned_arrival_at: null,
    actual_arrival_at: null,
    closed_at: null,
    driver: null,
    horse: null,
    trailers: [],
    phases: [],
    current_phase: null,
    current_stop: null,
    exceptions: [],
    blockchain_receipts: [],
    warnings: [],
    created_at: '2026-06-20T07:00:00Z',
    updated_at: '2026-06-20T07:00:00Z',
    ...overrides,
  }
}

describe('tripsForDriver', () => {
  it('returns only trips belonging to the given driver id', () => {
    const trips = [
      makeTrip({ id: 't1' as TripId, driver: { id: driverA } as Trip['driver'] }),
      makeTrip({ id: 't2' as TripId, driver: { id: driverB } as Trip['driver'] }),
    ]

    const result = tripsForDriver(trips, driverA)

    expect(result.map((t) => t.id)).toEqual(['t1'])
  })
})

describe('categorizeTrips', () => {
  it('puts non-terminal, non-created trips in active', () => {
    const trips = [makeTrip({ id: 't1' as TripId, status: 'active' })]

    const { active } = categorizeTrips(trips)

    expect(active.map((t) => t.id)).toEqual(['t1'])
  })

  it('puts created trips in upcoming', () => {
    const trips = [makeTrip({ id: 't1' as TripId, status: 'created' })]

    const { upcoming } = categorizeTrips(trips)

    expect(upcoming.map((t) => t.id)).toEqual(['t1'])
  })

  it('puts closed and cancelled trips in past', () => {
    const trips = [
      makeTrip({ id: 't1' as TripId, status: 'closed' }),
      makeTrip({ id: 't2' as TripId, status: 'cancelled' }),
    ]

    const { past } = categorizeTrips(trips)

    expect(past.map((t) => t.id).sort()).toEqual(['t1', 't2'])
  })
})

describe('sortByDeparture', () => {
  // The reported bug, exactly: a trip leaving on the 6th listed above one leaving on the 5th.
  const aug5 = makeTrip({ id: 'aug-5' as TripId, planned_departure_at: '2026-08-05T08:00:00Z' })
  const aug6 = makeTrip({ id: 'aug-6' as TripId, planned_departure_at: '2026-08-06T08:00:00Z' })
  const unscheduled = makeTrip({ id: 'no-date' as TripId, planned_departure_at: null })

  it('orders scheduled trips soonest departure first', () => {
    const result = sortByDeparture([aug6, aug5])

    expect(result.map((t) => t.id)).toEqual(['aug-5', 'aug-6'])
  })

  it('orders latest departure first when asked', () => {
    const result = sortByDeparture([aug5, aug6], 'latest-first')

    expect(result.map((t) => t.id)).toEqual(['aug-6', 'aug-5'])
  })

  it('sinks unscheduled trips to the bottom in both directions', () => {
    expect(sortByDeparture([unscheduled, aug6, aug5]).map((t) => t.id))
      .toEqual(['aug-5', 'aug-6', 'no-date'])
    expect(sortByDeparture([unscheduled, aug5, aug6], 'latest-first').map((t) => t.id))
      .toEqual(['aug-6', 'aug-5', 'no-date'])
  })

  it('falls back to the actual departure when none was planned', () => {
    const departedEarly = makeTrip({
      id: 'actual-only' as TripId,
      planned_departure_at: null,
      actual_departure_at: '2026-08-04T08:00:00Z',
    })

    const result = sortByDeparture([aug5, departedEarly])

    expect(result.map((t) => t.id)).toEqual(['actual-only', 'aug-5'])
  })

  it('leaves the caller\'s array untouched', () => {
    const input = [aug6, aug5]

    sortByDeparture(input)

    expect(input.map((t) => t.id)).toEqual(['aug-6', 'aug-5'])
  })
})

describe('filterPastTrips', () => {
  const trips = [
    makeTrip({
      id: 't1' as TripId, status: 'closed',
      origin_precinct_id: 'jhb', destination_precinct_id: 'dbn',
      actual_arrival_at: '2026-06-10T10:00:00Z',
    }),
    makeTrip({
      id: 't2' as TripId, status: 'closed',
      origin_precinct_id: 'ct', destination_precinct_id: 'jhb',
      actual_arrival_at: '2026-06-15T10:00:00Z',
    }),
  ]

  it('filters by date range using actual_arrival_at', () => {
    const result = filterPastTrips(trips, { dateFrom: '2026-06-12', dateTo: '2026-06-20', search: '' })

    expect(result.map((t) => t.id)).toEqual(['t2'])
  })

  it('filters by origin/destination search, case-insensitive', () => {
    const result = filterPastTrips(trips, { dateFrom: null, dateTo: null, search: 'JHB' })

    expect(result.map((t) => t.id).sort()).toEqual(['t1', 't2'])
  })

  it('returns all trips when no filters are set', () => {
    const result = filterPastTrips(trips, { dateFrom: null, dateTo: null, search: '' })

    expect(result).toHaveLength(2)
  })

  it('includes a non-Z-offset timestamp that falls within the UTC day boundary', () => {
    const offsetTrips = [
      makeTrip({
        id: 't3' as TripId, status: 'closed',
        origin_precinct_id: 'jhb', destination_precinct_id: 'dbn',
        actual_arrival_at: '2026-06-15T01:00:00+02:00', // equals 2026-06-14T23:00:00Z
      }),
    ]

    const result = filterPastTrips(offsetTrips, { dateFrom: null, dateTo: '2026-06-14', search: '' })

    expect(result.map((t) => t.id)).toEqual(['t3'])
  })
})
