// The Incidents list's client-side half: search, the "unassigned" owner view, sorting and paging.
// GET /incidents returns the whole organisation's list (volume is small), so only status, type and
// "assigned to me" go to the server; everything here runs on what came back.

import { compareText, sortRows, type Sort, type SortDir, type SortValue } from '@/lib/sort/sort-rows'
import type { IncidentStatus, IncidentSummary } from '@/lib/types/incident'

export const INCIDENT_SORT_KEYS = ['reference', 'type', 'status', 'cargo', 'owner', 'received'] as const
export type IncidentSortKey = typeof INCIDENT_SORT_KEYS[number]
export type IncidentSort = Sort<IncidentSortKey>

export const DEFAULT_INCIDENT_SORT: IncidentSort = { key: 'received', dir: 'desc' }

export type OwnerFilter = 'anyone' | 'mine' | 'unassigned'

const STATUS_RANK: Record<IncidentStatus, number> = { open: 0, investigating: 1, closed: 2 }

/** Time and unresolved counts read best biggest/newest first; text and status A to Z / most urgent first. */
export function defaultIncidentSortDirection(key: IncidentSortKey): SortDir {
  return key === 'received' || key === 'cargo' ? 'desc' : 'asc'
}

/** Case-insensitive match on the trip reference, the incident reference, the summary and the
 *  investigator's name. An empty query matches everything. */
export function matchesIncidentSearch(incident: IncidentSummary, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q.length === 0) return true
  return [incident.trip_reference, incident.reference, incident.summary, incident.assigned_to_name]
    .some(field => field?.toLowerCase().includes(q))
}

interface IncidentClientFilters {
  search: string
  owner: OwnerFilter
}

/** Search plus the "Unassigned" owner view. "Assigned to me" is applied by the server, so it
 *  needs no work here. */
export function filterIncidents(incidents: readonly IncidentSummary[], { search, owner }: IncidentClientFilters): IncidentSummary[] {
  return incidents.filter(incident =>
    (owner !== 'unassigned' || incident.assigned_to_user_id === null) && matchesIncidentSearch(incident, search))
}

function sortValue(incident: IncidentSummary, key: IncidentSortKey): SortValue {
  switch (key) {
    case 'reference': return [incident.trip_reference, incident.reference]
    case 'type': return incident.incident_type
    case 'status': return STATUS_RANK[incident.status]
    case 'cargo': return incident.parcels_total === 0 ? null : incident.parcels_unresolved
    case 'owner': return incident.assigned_to_name
    case 'received': return Date.parse(incident.received_at)
  }
}

const newestThenId = (a: IncidentSummary, b: IncidentSummary): number =>
  Date.parse(b.received_at) - Date.parse(a.received_at) || compareText(a.incident_id, b.incident_id)

export function sortIncidents(incidents: readonly IncidentSummary[], sort: IncidentSort): IncidentSummary[] {
  return sortRows(incidents, sort, sortValue, newestThenId)
}

export interface PageSlice<T> {
  rows: T[]
  page: number
  totalItems: number
  hasPrevious: boolean
  hasNext: boolean
}

export function paginate<T>(rows: readonly T[], page: number, pageSize: number): PageSlice<T> {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const current = Math.min(Math.max(1, page), pageCount)
  return {
    rows: rows.slice((current - 1) * pageSize, current * pageSize),
    page: current,
    totalItems: rows.length,
    hasPrevious: current > 1,
    hasNext: current < pageCount,
  }
}
