import { manifestLabel } from '@/lib/format/manifest'
import { routeShortName } from '@/lib/trips/route-name'
import { compareText, sortRows, type Sort, type SortDir, type SortValue } from '@/lib/sort/sort-rows'
import type { Precinct } from '@shared/lib/types/precinct'
import type { TripAttention, TripChecklistItem } from '@shared/lib/types/trip'
import { SEVERITIES_BY_RANK, SEVERITY_RANK } from '@/lib/exceptions/severity'

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

/** Most urgent first: the order both the Active Trips page and the dashboard open in. */
export const TRIP_ATTENTION_SORT: TripSort = { key: 'exceptions', dir: defaultTripSortDirection('exceptions') }

// Progress is how far through its plan a trip is. A trip with no plan has no meaningful position,
// so it is "no data" and sorts last rather than posing as "0% done".
function progressOf(trip: TripChecklistItem): number | null {
  return trip.phase_total > 0 ? trip.phase_completed / trip.phase_total : null
}

// History rows carry no severity split; they share one rank past the least severe, so among them
// the counts alone decide. A list never mixes them with dashboard rows, which always have the split.
const UNSPLIT_RANK = SEVERITIES_BY_RANK.length

// The worst severity with anything outstanding, on the shared scale (lower is more severe).
function worstSeverityRank(attention: TripAttention | undefined): number {
  if (!attention) return UNSPLIT_RANK
  const worst = SEVERITIES_BY_RANK.find(severity => attention[severity] > 0)
  return worst === undefined ? UNSPLIT_RANK : SEVERITY_RANK[worst]
}

// Where the dashboard ranks a trip, compared element by element by sortRows. A trip needing review
// leads with tier 0, so it sits above every trip that needs none; within that tier one critical
// outranks any number of warnings, then the trip with more exceptions nobody has claimed comes
// first, because a claimed one already has an owner. Counts are negated so ascending, the default,
// puts the most urgent at the top. Every other trip is tier 1, ordered by progress; "no plan" is
// null and sorts last.
function attentionKey(trip: TripChecklistItem): readonly number[] | null {
  const total = trip.needs_review_count
  if (total > 0) {
    const unclaimed = total - (trip.attention?.claimed ?? 0)
    return [0, worstSeverityRank(trip.attention), -unclaimed, -total]
  }
  const progress = progressOf(trip)
  return progress === null ? null : [1, progress]
}

function sortValue(trip: TripChecklistItem, key: TripSortKey, precincts: readonly Precinct[]): SortValue {
  switch (key) {
    case 'date': return Date.parse(trip.created_at)
    case 'trip': return trip.trip_reference
    case 'manifest': return manifestLabel(trip.pp_manifest, trip.trip_type ?? null)
    case 'driver': return trip.driver.full_name
    // Origin then destination, using the same names the cell shows, so sorting and display agree.
    case 'route': return `${routeShortName(precincts, trip.origin_precinct_id)} ${routeShortName(precincts, trip.destination_precinct_id)}`
    case 'exceptions': return attentionKey(trip)
    // The cell shows the phase with the plan position beneath it, so the column runs in plan order:
    // phase names alphabetically ("Departure", "In transit", "Loading") would be no order at all.
    case 'status': return progressOf(trip)
  }
}

// Equal rows keep a stable order across live refreshes: creation time, then id.
const byCreationThenId = (a: TripChecklistItem, b: TripChecklistItem): number =>
  Date.parse(a.created_at) - Date.parse(b.created_at) || compareText(a.id, b.id)

/** A sorted copy of the trips. */
export function sortTrips<T extends TripChecklistItem>(trips: readonly T[], sort: TripSort, precincts: readonly Precinct[]): T[] {
  return sortRows(trips, sort, (trip, key) => sortValue(trip, key, precincts), byCreationThenId)
}
