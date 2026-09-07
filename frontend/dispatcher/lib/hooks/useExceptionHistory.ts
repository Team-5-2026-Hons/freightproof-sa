'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '@/lib/api/client'
import type {
  ExceptionReviewStatus,
  ExceptionSeverity,
  TripExceptionListItem,
} from '@shared/lib/types/exception'
import type { CursorPage } from '@shared/lib/types/pagination'

// Matches the backend's own default (schemas/pagination.py) — the frontend does not
// let a dispatcher change it, so it is a constant rather than a piece of state.
const PAGE_SIZE = 25

const EMPTY: TripExceptionListItem[] = []

export interface ExceptionHistoryFilters {
  q?: string
  // Typed as the full ExceptionReviewStatus union rather than narrowed to
  // 'recorded' | 'reviewed': the server already tolerates 'needs_review' by yielding
  // zero rows for it, so duplicating that narrowing here would just be a second place
  // for the two definitions to drift apart.
  reviewStatus?: ExceptionReviewStatus
  severity?: ExceptionSeverity
  fromDate?: string
  toDate?: string
}

export interface UseExceptionHistoryResult {
  items: TripExceptionListItem[]
  isLoading: boolean
  error: string | null
  // True when the last refresh failed but `items` is still showing an earlier
  // successful result rather than an empty/cleared list — the UI must say the data
  // may be out of date rather than silently presenting stale rows as current.
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
 * cursor-paginated. Deliberately does NOT use useAsyncData: that hook holds one fetch
 * function in a ref and refetches only when its identity changes, which cannot express
 * "changing a filter must jump back to page 1" without reaching into a hook every other
 * screen shares. Instead this owns its own fetch effect and guards it with a
 * request-generation counter so a slow, now-superseded request can never overwrite a
 * newer one's result — see the effect below.
 *
 * No realtime subscription: unlike the review queue, this is a static archive a
 * dispatcher is actively paging through, and rows here are already the closed cases —
 * a live update mid-scroll would reorder or resize pages under someone's cursor.
 */
export function useExceptionHistory(filters: ExceptionHistoryFilters): UseExceptionHistoryResult {
  const [items, setItems] = useState<TripExceptionListItem[]>(EMPTY)
  const [totalItems, setTotalItems] = useState(0)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isStale, setIsStale] = useState(false)

  // cursorStack[0] is always undefined (page 1 needs no cursor); cursorStack[n] is the
  // cursor that fetches page n + 1. Recorded once, on first visit, so paging backward
  // never has to mint (or re-derive) a cursor the server already handed us.
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([undefined])
  const [pageIndex, setPageIndex] = useState(0)

  // Primitive dependency key, not the filters object itself — mirrors useTrips.ts's
  // statusKey pattern, so a caller passing a fresh object literal every render doesn't
  // trigger a refetch (and, here, an unwanted page-1 reset) on every render.
  const q = filters.q ?? ''
  const reviewStatus = filters.reviewStatus ?? ''
  const severity = filters.severity ?? ''
  const fromDate = filters.fromDate ?? ''
  const toDate = filters.toDate ?? ''
  const filterKey = `${q}|${reviewStatus}|${severity}|${fromDate}|${toDate}`

  // Reset to page 1 the moment a filter changes, done DURING render (React's sanctioned
  // "adjusting state when a prop changes" pattern) rather than in an effect. An
  // effect-based reset would still leave the fetch effect below reading the OLD
  // pageIndex/cursorStack for one pass — the wrong page's cursor going out under the
  // NEW filters — before a second render corrected it. Resetting in-render means the
  // fetch effect never observes that inconsistent combination.
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
  const cursor = cursorStack[pageIndex]

  const runFetch = useCallback((showLoadingSpinner: boolean) => {
    const generation = ++requestGenerationRef.current
    if (showLoadingSpinner) setIsLoading(true)
    setError(null)

    api.get<CursorPage<TripExceptionListItem>>(buildQuery(filters, cursor))
      .then((page) => {
        if (requestGenerationRef.current !== generation) return
        setItems(page.items)
        setTotalItems(page.total_items)
        setNextCursor(page.next_cursor)
        setError(null)
        setIsStale(false)
        setIsLoading(false)
      })
      .catch((err: unknown) => {
        if (requestGenerationRef.current !== generation) return
        // Deliberately do not touch items/totalItems/nextCursor: the previous
        // successful page stays on screen, flagged stale, rather than being cleared.
        setError(err instanceof Error ? err.message : 'An unexpected error occurred')
        setIsStale(true)
        setIsLoading(false)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, cursor])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    runFetch(true)
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
