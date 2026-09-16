'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '@/lib/api/client'
import type {
  ExceptionReviewStatus,
  ExceptionSeverity,
  TripExceptionListItem,
} from '@shared/lib/types/exception'
import type { CursorPage } from '@shared/lib/types/pagination'

// Matches the backend's own default (schemas/pagination.py); not dispatcher-adjustable.
const PAGE_SIZE = 25

const EMPTY: TripExceptionListItem[] = []

export interface ExceptionHistoryFilters {
  q?: string
  // Full ExceptionReviewStatus union, not narrowed: the server already tolerates
  // 'needs_review' by yielding zero rows for it.
  reviewStatus?: ExceptionReviewStatus
  severity?: ExceptionSeverity
  fromDate?: string
  toDate?: string
}

export interface UseExceptionHistoryResult {
  items: TripExceptionListItem[]
  isLoading: boolean
  error: string | null
  // True when the last refresh failed but `items` still shows an earlier successful
  // result — the UI must flag it as possibly out of date, not present it as current.
  isStale: boolean
  totalItems: number
  page: number
  pageSize: number
  hasPrevious: boolean
  hasNext: boolean
  goToNextPage: () => void
  goToPreviousPage: () => void
  refetch: () => void
}

function buildQuery(filters: ExceptionHistoryFilters, cursor: string | undefined): string {
  const params = new URLSearchParams()
  params.set('limit', String(PAGE_SIZE))
  if (cursor) params.set('cursor', cursor)
  if (filters.q) params.set('q', filters.q)
  if (filters.reviewStatus) params.set('review_status', filters.reviewStatus)
  if (filters.severity) params.set('severity', filters.severity)
  if (filters.fromDate) params.set('from_date', filters.fromDate)
  if (filters.toDate) params.set('to_date', filters.toDate)
  return `/api/v1/exceptions/history?${params.toString()}`
}

/**
 * The dispatcher's browsable exception archive — GET /api/v1/exceptions/history,
 * cursor-paginated. Doesn't use useAsyncData: that hook can't express "changing a filter
 * jumps back to page 1", so this owns its own fetch effect guarded by a
 * request-generation counter (a superseded request can never overwrite a newer result).
 *
 * No realtime subscription: unlike the review queue this is a static archive a dispatcher
 * is actively paging through, and a live update mid-scroll would reorder pages underfoot.
 */
export function useExceptionHistory(filters: ExceptionHistoryFilters): UseExceptionHistoryResult {
  const [items, setItems] = useState<TripExceptionListItem[]>(EMPTY)
  const [totalItems, setTotalItems] = useState(0)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isStale, setIsStale] = useState(false)

  // cursorStack[0] is always undefined (page 1 needs no cursor); cursorStack[n] is the
  // cursor that fetches page n + 1, recorded once on first visit.
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([undefined])
  const [pageIndex, setPageIndex] = useState(0)

  // Primitive dependency key, not the filters object, so a fresh object literal every
  // render doesn't trigger a refetch (mirrors useTrips.ts's statusKey pattern).
  const q = filters.q ?? ''
  const reviewStatus = filters.reviewStatus ?? ''
  const severity = filters.severity ?? ''
  const fromDate = filters.fromDate ?? ''
  const toDate = filters.toDate ?? ''
  const filterKey = `${q}|${reviewStatus}|${severity}|${fromDate}|${toDate}`

  // Reset to page 1 the moment a filter changes, DURING render (React's sanctioned
  // pattern), not in an effect — an effect-based reset would let the fetch effect below
  // read the OLD cursor against the NEW filters for one pass.
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey)
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey)
    setCursorStack([undefined])
    setPageIndex(0)
  }

  // Bumped on every fetch kicked off below; a response is applied only if this counter
  // has not moved on since — i.e. no newer request (a page change or a filter change)
  // has started in the meantime. This is what makes a late, superseded response
  // harmless instead of a race that overwrites fresher data with stale rows.
  const requestGenerationRef = useRef(0)
  const hasSuccessfulResultRef = useRef(false)
  const cursor = cursorStack[pageIndex]

  const runFetch = useCallback((preserveCurrentResult: boolean) => {
    const generation = ++requestGenerationRef.current
    const canRetainStaleResult = preserveCurrentResult && hasSuccessfulResultRef.current
    setIsLoading(true)
    setError(null)
    if (!preserveCurrentResult) {
      // A page or filter change is a different query. Clear the previous query's
      // rows and cursor before starting it so a failed request cannot leave controls
      // pointing at one result set while rendering another result set's data.
      setItems(EMPTY)
      setTotalItems(0)
      setNextCursor(null)
      setIsStale(false)
      hasSuccessfulResultRef.current = false
    }

    api.get<CursorPage<TripExceptionListItem>>(buildQuery(filters, cursor))
      .then((page) => {
        if (requestGenerationRef.current !== generation) return
        setItems(page.items)
        setTotalItems(page.total_items)
        setNextCursor(page.next_cursor)
        setError(null)
        setIsStale(false)
        setIsLoading(false)
        hasSuccessfulResultRef.current = true
      })
      .catch((err: unknown) => {
        if (requestGenerationRef.current !== generation) return
        // A manual refresh of the same successful query may keep its last result.
        // Foreground page/filter navigation was cleared before this request began.
        setError(err instanceof Error ? err.message : 'An unexpected error occurred')
        setIsStale(canRetainStaleResult)
        setIsLoading(false)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, cursor])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    runFetch(false)
  }, [runFetch])

  const hasPrevious = pageIndex > 0
  const hasNext = nextCursor !== null

  const goToNextPage = useCallback(() => {
    if (!hasNext || nextCursor === null) return
    setCursorStack((stack) => {
      // Going forward always means recording a new entry: a dispatcher cannot have
      // visited a page beyond the current stack length yet.
      if (stack[pageIndex + 1] !== undefined) return stack
      const next = stack.slice(0, pageIndex + 1)
      next[pageIndex + 1] = nextCursor
      return next
    })
    setPageIndex((i) => i + 1)
  }, [hasNext, nextCursor, pageIndex])

  const goToPreviousPage = useCallback(() => {
    if (!hasPrevious) return
    setPageIndex((i) => i - 1)
  }, [hasPrevious])

  const refetch = useCallback(() => runFetch(true), [runFetch])

  return {
    items,
    isLoading,
    error,
    isStale,
    totalItems,
    page: pageIndex + 1,
    pageSize: PAGE_SIZE,
    hasPrevious,
    hasNext,
    goToNextPage,
    goToPreviousPage,
    refetch,
  }
}
