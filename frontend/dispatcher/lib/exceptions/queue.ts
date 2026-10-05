import type { TripExceptionListItem } from '@shared/lib/types/exception'
import { exceptionCalendarDay, fmtExceptionType } from '@/lib/format/exception'
import { sortRows, type SortValue } from '@/lib/sort/sort-rows'

export interface QueueFilters { q?: string; severity?: TripExceptionListItem['severity'] | ''; fromDate?: string; toDate?: string }

/** Invalid timestamps cannot imply recency. Sort a copy so live hook data stays intact. */
export function sortQueueChronologically<T extends { id: string; created_at: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const at = Date.parse(a.created_at), bt = Date.parse(b.created_at)
    const av = Number.isFinite(at), bv = Number.isFinite(bt)
    if (av !== bv) return av ? -1 : 1
    if (av && at !== bt) return bt - at
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

export type ExceptionSortKey = 'incident' | 'trip' | 'crew' | 'raised' | 'status'
export interface ExceptionSort { key: ExceptionSortKey; dir: 'asc' | 'desc' }
/** Newest first, the queue's confirmed default (see the redesign plan). */
export const DEFAULT_EXCEPTION_SORT: ExceptionSort = { key: 'raised', dir: 'desc' }
export const EXCEPTION_SORT_KEYS: readonly ExceptionSortKey[] = ['incident', 'trip', 'crew', 'raised', 'status']

// Most severe first when ascending, so the first click on Incident surfaces what matters.
const SEVERITY_RANK: Record<TripExceptionListItem['severity'], number> = { critical: 0, warning: 1, info: 2 }

/** A value the column can order by; null means "no data" and always sorts last. */
function sortValue(item: TripExceptionListItem, key: ExceptionSortKey): SortValue {
  switch (key) {
    // Severity first, then the title the dispatcher reads, so equal severities group by type.
    case 'incident': return `${SEVERITY_RANK[item.severity]} ${fmtExceptionType(item.exception_type)}`
    case 'trip': return item.trip_reference
    case 'crew': return item.driver_name
    case 'raised': return Date.parse(item.created_at)
    case 'status': return item.claimed_by_user_id === null ? '0' : `1 ${item.claimed_by_name ?? ''}`
  }
}

/** Sorted copy of the complete tab set. The input is put in the queue's own order first (newest
 *  first, then id) and the sort is stable, so equal values keep that order and never shuffle between
 *  refetches. "No data" is last in both directions: it is neither the smallest nor the largest value. */
export function sortQueue(items: readonly TripExceptionListItem[], sort: ExceptionSort): TripExceptionListItem[] {
  return sortRows(sortQueueChronologically(items), sort, sortValue)
}

/** Filters apply to the complete tab set, in its existing order; %, _ are literal. */
export function filterQueue(items: readonly TripExceptionListItem[], filters: QueueFilters): TripExceptionListItem[] {
  const q = (filters.q ?? '').toLocaleLowerCase()
  return items.filter(item => {
    if (filters.severity && item.severity !== filters.severity) return false
    if (q && !`${item.description}\n${item.trip_reference}`.toLocaleLowerCase().includes(q)) return false
    const day = exceptionCalendarDay(item.created_at)
    if ((filters.fromDate || filters.toDate) && !day) return false
    return (!filters.fromDate || day! >= filters.fromDate) && (!filters.toDate || day! <= filters.toDate)
  })
}

export interface ExceptionTripGroup {
  tripId: string; tripReference: string; items: TripExceptionListItem[]
  severityCounts: Record<TripExceptionListItem['severity'], number>
  newestRaised: string | null; oldestRaised: string | null; unreviewedCount: number; claimCount: number
}
export function groupQueueByTrip(items: readonly TripExceptionListItem[]): ExceptionTripGroup[] {
  const byTrip = new Map<string, ExceptionTripGroup>()
  const seen = new Set<string>()
  for (const item of sortQueueChronologically(items)) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    let group = byTrip.get(item.trip_id)
    if (!group) {
      group = { tripId: item.trip_id, tripReference: item.trip_reference, items: [], severityCounts: {critical:0,warning:0,info:0}, newestRaised:null,oldestRaised:null,unreviewedCount:0,claimCount:0 }
      byTrip.set(item.trip_id, group)
    }
    group.items.push(item); group.severityCounts[item.severity]++
    if (item.review_status === 'needs_review') group.unreviewedCount++
    if (item.claimed_by_user_id !== null) group.claimCount++
    if (Number.isFinite(Date.parse(item.created_at))) {
      group.newestRaised ??= item.created_at
      group.oldestRaised = item.created_at
    }
  }
  return [...byTrip.values()].sort((a,b) => {
    const at = a.newestRaised ? Date.parse(a.newestRaised) : -Infinity
    const bt = b.newestRaised ? Date.parse(b.newestRaised) : -Infinity
    return at !== bt ? bt - at : a.tripId < b.tripId ? -1 : a.tripId > b.tripId ? 1 : 0
  })
}

export const EXCEPTION_BATCH_LIMIT = 100
