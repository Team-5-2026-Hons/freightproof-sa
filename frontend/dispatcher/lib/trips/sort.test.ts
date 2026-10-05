import { describe, expect, it } from 'vitest'

import { defaultTripSortDirection, isTripSortKey, sortTrips, type TripSortKey } from './sort'
import type { Precinct } from '@shared/lib/types/precinct'
import type { TripChecklistItem } from '@shared/lib/types/trip'

function precinct(id: string, name: string): Precinct {
  return { id, name } as unknown as Precinct
}
const PRECINCTS = [precinct('cpt', 'Cape Town — Depot'), precinct('jnb', 'Johannesburg — Depot'), precinct('dbn', 'Durban — Depot')]

function trip(id: string, overrides: Partial<TripChecklistItem> = {}): TripChecklistItem {
  return {
    id: id as TripChecklistItem['id'],
    trip_reference: `FP-${id}`,
    pp_manifest: null,
    status: 'active',
    driver: { full_name: 'Sipho' },
    horse: { registration: 'GP 1' },
    origin_precinct_id: 'cpt',
    destination_precinct_id: 'jnb',
    needs_review_count: 0,
    created_at: '2026-10-01T08:00:00Z',
    current_phase: 'loading',
    current_stop: 0,
    phase_total: 7,
    phase_completed: 2,
    ...overrides,
  }
}

const ids = (trips: TripChecklistItem[]): string[] => trips.map(t => t.id)

describe('sortTrips', () => {
  it('sorts text columns A to Z and back, ignoring case', () => {
    const trips = [trip('a', { driver: { full_name: 'thandi' } }), trip('b', { driver: { full_name: 'Aisha' } }), trip('c', { driver: { full_name: 'Moses' } })]

    expect(ids(sortTrips(trips, { key: 'driver', dir: 'asc' }, PRECINCTS))).toEqual(['b', 'c', 'a'])
    expect(ids(sortTrips(trips, { key: 'driver', dir: 'desc' }, PRECINCTS))).toEqual(['a', 'c', 'b'])
  })

  it('sorts by creation time, and by trip reference with numbers in natural order', () => {
    const trips = [
      trip('a', { created_at: '2026-10-03T08:00:00Z', trip_reference: 'FP-10' }),
      trip('b', { created_at: '2026-10-01T08:00:00Z', trip_reference: 'FP-9' }),
    ]

    expect(ids(sortTrips(trips, { key: 'date', dir: 'asc' }, PRECINCTS))).toEqual(['b', 'a'])
    expect(ids(sortTrips(trips, { key: 'trip', dir: 'asc' }, PRECINCTS))).toEqual(['b', 'a'])
  })

  it('sorts routes by origin area, then destination, using the same names the cell shows', () => {
    const trips = [
      trip('a', { origin_precinct_id: 'jnb', destination_precinct_id: 'cpt' }),
      trip('b', { origin_precinct_id: 'cpt', destination_precinct_id: 'jnb' }),
      trip('c', { origin_precinct_id: 'cpt', destination_precinct_id: 'dbn' }),
    ]

    expect(ids(sortTrips(trips, { key: 'route', dir: 'asc' }, PRECINCTS))).toEqual(['c', 'b', 'a'])
  })

  it('sorts manifests by label and says empty legs are named, not blank', () => {
    const trips = [
      trip('a', { pp_manifest: { issuer_account: 'M', origin_hub: 'JNB', number: 2, display: 'CGY · JNB 2' } }),
      trip('b', { pp_manifest: null, trip_type: 'empty_leg' }),
    ]

    expect(ids(sortTrips(trips, { key: 'manifest', dir: 'asc' }, PRECINCTS))).toEqual(['a', 'b'])
  })

  it('sorts status by the chip label the dispatcher reads', () => {
    const trips = [trip('a', { current_phase: 'unloading' }), trip('b', { current_phase: 'loading' })]

    expect(ids(sortTrips(trips, { key: 'status', dir: 'asc' }, PRECINCTS))).toEqual(['b', 'a'])
  })

  it('sorts progress by fraction complete, with a trip that has no plan last in both directions', () => {
    const trips = [
      trip('none', { phase_total: 0, phase_completed: 0 }),
      trip('half', { phase_total: 10, phase_completed: 5 }),
      trip('most', { phase_total: 7, phase_completed: 6 }),
    ]

    expect(ids(sortTrips(trips, { key: 'exceptions', dir: 'asc' }, PRECINCTS))).toEqual(['half', 'most', 'none'])
    expect(ids(sortTrips(trips, { key: 'exceptions', dir: 'desc' }, PRECINCTS))).toEqual(['most', 'half', 'none'])
  })

  it('breaks ties by creation time then id, so equal rows never shuffle', () => {
    const trips = [
      trip('z', { driver: { full_name: 'Same' }, created_at: '2026-10-02T08:00:00Z' }),
      trip('y', { driver: { full_name: 'Same' }, created_at: '2026-10-01T08:00:00Z' }),
      trip('x', { driver: { full_name: 'Same' }, created_at: '2026-10-01T08:00:00Z' }),
    ]

    expect(ids(sortTrips(trips, { key: 'driver', dir: 'asc' }, PRECINCTS))).toEqual(['x', 'y', 'z'])
    // The tie-break does not flip with the direction: a descending sort keeps equal rows steady too.
    expect(ids(sortTrips(trips, { key: 'driver', dir: 'desc' }, PRECINCTS))).toEqual(['x', 'y', 'z'])
  })

  it('returns a new array and leaves the input untouched', () => {
    const trips = [trip('b', { driver: { full_name: 'B' } }), trip('a', { driver: { full_name: 'A' } })]
    const before = ids(trips)

    const sorted = sortTrips(trips, { key: 'driver', dir: 'asc' }, PRECINCTS)

    expect(sorted).not.toBe(trips)
    expect(ids(trips)).toEqual(before)
  })
})

describe('trip sort keys', () => {
  it('recognises exactly the table column ids and defaults the date to newest first', () => {
    for (const key of ['date', 'trip', 'manifest', 'driver', 'route', 'exceptions', 'status']) expect(isTripSortKey(key)).toBe(true)
    expect(isTripSortKey('horse')).toBe(false)
    expect(defaultTripSortDirection('date')).toBe('desc')
    expect((['trip', 'driver', 'route'] as TripSortKey[]).map(defaultTripSortDirection)).toEqual(['asc', 'asc', 'asc'])
  })
})
