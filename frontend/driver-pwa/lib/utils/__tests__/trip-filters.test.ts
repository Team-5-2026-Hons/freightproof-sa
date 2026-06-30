import { describe, it, expect } from 'vitest'
import { tripsForDriver, categorizeTrips, filterPastTrips } from '../trip-filters'
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
    journey_lock_hash: null,
    idvs_check_status: 'pending',
    origin_precinct_id: 'origin-1',
    destination_precinct_id: 'dest-1',
    pulsit_trip_reference_id: null,
    planned_departure_at: '2026-06-20T08:00:00Z',
    actual_departure_at: null,
    planned_arrival_at: null,
    actual_arrival_at: null,
    closed_at: null,
    driver: null,
    horse: null,
    trailers: [],
    handshakes: [],
    exceptions: [],
    blockchain_receipts: [],
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
    const trips = [makeTrip({ id: 't1' as TripId, status: 'in_transit' })]

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
