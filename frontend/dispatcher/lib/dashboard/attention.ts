// What the dashboard's Exceptions and Incidents panels put in front of a dispatcher: the work
// that still needs them, worst first, not a feed of everything recent. Pure so the ordering is
// testable without a page; the panels cap the result at PANEL_ROW_LIMIT and show the full count.

import { SEVERITY_RANK } from '@/lib/exceptions/severity'
import { compareText, sortRows, type Sort } from '@/lib/sort/sort-rows'
import { DEFAULT_INCIDENT_SORT, sortIncidents } from '@/lib/incidents/incident-list'
import { isActiveTrip } from '@/lib/trips/active'
import { sortTrips, TRIP_ATTENTION_SORT } from '@/lib/trips/sort'
import type { IncidentSummary } from '@/lib/types/incident'
import type { Precinct } from '@shared/lib/types/precinct'
import type { TripSummary } from '@shared/lib/types/trip'
import type { TripExceptionListItem } from '@shared/lib/types/exception'

export const PANEL_ROW_LIMIT = 5

export const DASHBOARD_TRIP_LIMIT = 8

const SEVERITY_FIRST: Sort<'severity'> = { key: 'severity', dir: 'asc' }

const newestThenId = (a: TripExceptionListItem, b: TripExceptionListItem): number =>
  (Number.isFinite(Date.parse(b.created_at)) ? Date.parse(b.created_at) : -Infinity)
  - (Number.isFinite(Date.parse(a.created_at)) ? Date.parse(a.created_at) : -Infinity)
  || compareText(a.id, b.id)

/** Exceptions still awaiting review, most severe first and newest first within a severity. */
export function exceptionsNeedingAttention(items: readonly TripExceptionListItem[]): TripExceptionListItem[] {
  const open = items.filter(item => item.review_status === 'needs_review')
  return sortRows(open, SEVERITY_FIRST, item => SEVERITY_RANK[item.severity], newestThenId)
}

/** Incidents that are not closed, newest report first (the Incidents page's own default order). */
export function openIncidents(incidents: readonly IncidentSummary[]): IncidentSummary[] {
  return sortIncidents(incidents.filter(incident => incident.status !== 'closed'), DEFAULT_INCIDENT_SORT)
}

/** Active trips in the Active Trips page's attention order: trips with unreviewed exceptions first,
 *  worst first, then the rest by progress. Uncapped, so the panel can state the true total; it
 *  slices to DASHBOARD_TRIP_LIMIT itself. */
export function activeTripsByAttention(trips: readonly TripSummary[], precincts: readonly Precinct[]): TripSummary[] {
  return sortTrips(trips.filter(isActiveTrip), TRIP_ATTENTION_SORT, precincts)
}
