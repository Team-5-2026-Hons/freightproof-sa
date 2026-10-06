import { manifestLabel } from '@/lib/format/manifest'
import { tripChipMeta } from '@/lib/phase/derive'
import { routeShortName } from '@/lib/trips/route-name'
import { compareText, sortRows, type Sort, type SortDir, type SortValue } from '@/lib/sort/sort-rows'
import type { Precinct } from '@shared/lib/types/precinct'
import type { TripChecklistItem } from '@shared/lib/types/trip'

/** Ids match the trip table's column ids, so a header click maps straight to a key. */
export const TRIP_SORT_KEYS = ['date', 'trip', 'manifest', 'driver', 'route', 'exceptions', 'status'] as const
export type TripSortKey = typeof TRIP_SORT_KEYS[number]
export type TripSort = Sort<TripSortKey>

export function isTripSortKey(id: string): id is TripSortKey {
  return (TRIP_SORT_KEYS as readonly string[]).includes(id)
}

/** A date reads best newest first; every text column A to Z. */
export function defaultTripSortDirection(key: TripSortKey): SortDir {
  return key === 'date' ? 'desc' : 'asc'
}

// Progress is how far through its plan a trip is. A trip with no plan has no meaningful position,
// so it is "no data" and sorts last rather than posing as "0% done".
function progressOf(trip: TripChecklistItem): number | null {
  return trip.phase_total > 0 ? trip.phase_completed / trip.phase_total : null
}

// The Progress cell leads with "⚠ N exceptions" when a trip needs review, so the column sorts that
// first. One number carries both: a trip needing review is -N (always below any progress, which is
// 0 to 1, and more exceptions are lower), every other trip is its progress. Ascending, the first
// click, therefore puts the most exceptions at the top; "no plan" stays null and sorts last.
function exceptionsThenProgress(trip: TripChecklistItem): number | null {
  return trip.needs_review_count > 0 ? -trip.needs_review_count : progressOf(trip)
}

function sortValue(trip: TripChecklistItem, key: TripSortKey, precincts: readonly Precinct[]): SortValue {
  switch (key) {
    case 'date': return Date.parse(trip.created_at)
    case 'trip': return trip.trip_reference
    case 'manifest': return manifestLabel(trip.pp_manifest, trip.trip_type ?? null)
    case 'driver': return trip.driver.full_name
    // Origin then destination, using the same names the cell shows, so sorting and display agree.
    case 'route': return `${routeShortName(precincts, trip.origin_precinct_id)} ${routeShortName(precincts, trip.destination_precinct_id)}`
    case 'exceptions': return exceptionsThenProgress(trip)
    case 'status': return tripChipMeta(trip.status, trip.current_phase).label
  }
}

// Equal rows keep a stable order across live refreshes: creation time, then id.
const byCreationThenId = (a: TripChecklistItem, b: TripChecklistItem): number =>
  Date.parse(a.created_at) - Date.parse(b.created_at) || compareText(a.id, b.id)

/** A sorted copy of the trips. */
export function sortTrips<T extends TripChecklistItem>(trips: readonly T[], sort: TripSort, precincts: readonly Precinct[]): T[] {
  return sortRows(trips, sort, (trip, key) => sortValue(trip, key, precincts), byCreationThenId)
}
