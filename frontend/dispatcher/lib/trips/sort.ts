import { manifestLabel } from '@/lib/format/manifest'
import { routeShortName } from '@/lib/trips/route-name'
import { compareText, sortRows, type Sort, type SortDir, type SortValue } from '@/lib/sort/sort-rows'
import type { Precinct } from '@shared/lib/types/precinct'
import type { TripAttention, TripChecklistItem } from '@shared/lib/types/trip'
import { SEVERITIES_BY_RANK, SEVERITY_RANK } from '@/lib/exceptions/severity'

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

export const TRIP_ATTENTION_SORT: TripSort = { key: 'exceptions', dir: defaultTripSortDirection('exceptions') }

function progressOf(trip: TripChecklistItem): number | null {
  return trip.phase_total > 0 ? trip.phase_completed / trip.phase_total : null
}

const UNSPLIT_RANK = SEVERITIES_BY_RANK.length

function worstSeverityRank(attention: TripAttention | undefined): number {
  if (!attention) return UNSPLIT_RANK
  const worst = SEVERITIES_BY_RANK.find(severity => attention[severity] > 0)
  return worst === undefined ? UNSPLIT_RANK : SEVERITY_RANK[worst]
}

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
    case 'route': return `${routeShortName(precincts, trip.origin_precinct_id)} ${routeShortName(precincts, trip.destination_precinct_id)}`
    case 'exceptions': return attentionKey(trip)
    case 'status': return progressOf(trip)
  }
}

const byCreationThenId = (a: TripChecklistItem, b: TripChecklistItem): number =>
  Date.parse(a.created_at) - Date.parse(b.created_at) || compareText(a.id, b.id)

/** A sorted copy of the trips. */
export function sortTrips<T extends TripChecklistItem>(trips: readonly T[], sort: TripSort, precincts: readonly Precinct[]): T[] {
  return sortRows(trips, sort, (trip, key) => sortValue(trip, key, precincts), byCreationThenId)
}
