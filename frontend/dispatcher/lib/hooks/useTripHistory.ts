'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '@/lib/api/client'
import { useLiveResource } from '@/lib/realtime/useLiveResource'
import type { CursorPage } from '@shared/lib/types/pagination'
import type { TripHistoryListItem } from '@shared/lib/types/trip'

const PAGE_SIZE = 25
const SEARCH_DEBOUNCE_MS = 300
const EMPTY: TripHistoryListItem[] = []

export interface TripHistoryFilters {
  q?: string
  precinctId?: string
  fromDate?: string
  toDate?: string
}

export interface UseTripHistoryResult {
  items: TripHistoryListItem[]
  isLoading: boolean
  error: string | null
  isStale: boolean
  totalItems: number
  page: number
  pageSize: number
  hasPrevious: boolean
  hasNext: boolean
  hasNewHistory: boolean
  goToNextPage: () => void
  goToPreviousPage: () => void
  refetch: () => void
  showNewHistory: () => void
}

interface NormalizedFilters {
  q: string
  precinctId: string
  fromDate: string
  toDate: string
}

function buildQuery(filters: NormalizedFilters, cursor: string | undefined): string {
  const params = new URLSearchParams()
  params.set('limit', String(PAGE_SIZE))
  if (cursor) params.set('cursor', cursor)
  if (filters.q) params.set('q', filters.q)
  if (filters.precinctId) params.set('precinct_id', filters.precinctId)
  if (filters.fromDate) params.set('from_date', filters.fromDate)
  if (filters.toDate) params.set('to_date', filters.toDate)
  return `/api/v1/trips/history?${params.toString()}`
}

/** Cursor-paginated terminal trips. Search settles briefly; route/date filters reset
 * immediately. Only trip_closed can change archive membership, and later pages stay
 * fixed until the dispatcher explicitly elects to return to the newest results. */
export function useTripHistory(filters: TripHistoryFilters): UseTripHistoryResult {
  const rawQ = filters.q ?? ''
  const precinctId = filters.precinctId ?? ''
  const fromDate = filters.fromDate ?? ''
  const toDate = filters.toDate ?? ''
  const [debouncedQ, setDebouncedQ] = useState(rawQ)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(rawQ), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [rawQ])

  const normalizedFilters: NormalizedFilters = { q: debouncedQ, precinctId, fromDate, toDate }
  const filterKey = `${debouncedQ}|${precinctId}|${fromDate}|${toDate}`

  const [items, setItems] = useState<TripHistoryListItem[]>(EMPTY)
  const [totalItems, setTotalItems] = useState(0)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isStale, setIsStale] = useState(false)
  const [hasNewHistory, setHasNewHistory] = useState(false)
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([undefined])
  const [pageIndex, setPageIndex] = useState(0)

  // Adjust pagination during render so the fetch effect never observes a new filter
  // with the previous filter's cursor for one intervening request.
  const [previousFilterKey, setPreviousFilterKey] = useState(filterKey)
  if (filterKey !== previousFilterKey) {
    setPreviousFilterKey(filterKey)
    setCursorStack([undefined])
    setPageIndex(0)
    setHasNewHistory(false)
  }

  const requestGenerationRef = useRef(0)
  const cursor = cursorStack[pageIndex]

  const runFetch = useCallback((showLoadingSpinner: boolean) => {
    const generation = ++requestGenerationRef.current
    if (showLoadingSpinner) {
      // A page or filter transition changes what the rows mean. Clear the old
      // result up front so a failed foreground request cannot label those rows as
      // belonging to the newly selected page or filters.
      setItems(EMPTY)
      setTotalItems(0)
      setNextCursor(null)
      setIsStale(false)
      setIsLoading(true)
    }
    setError(null)

    api.get<CursorPage<TripHistoryListItem>>(buildQuery(normalizedFilters, cursor))
      .then((response) => {
        if (requestGenerationRef.current !== generation) return
        setItems(response.items)
        setTotalItems(response.total_items)
        setNextCursor(response.next_cursor)
        setError(null)
        setIsStale(false)
        setIsLoading(false)
        if (cursor === undefined) setHasNewHistory(false)
      })
      .catch((err: unknown) => {
        if (requestGenerationRef.current !== generation) return
        setError(err instanceof Error ? err.message : 'An unexpected error occurred')
        // Only a silent page-one realtime refresh has a same-query result worth
        // retaining. Foreground transitions cleared their mismatched rows above.
        setIsStale(!showLoadingSpinner)
        setIsLoading(false)
      })
  // normalizedFilters is represented by the primitive key to avoid refetching when a
  // caller supplies a fresh object literal with unchanged values.
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
      if (stack[pageIndex + 1] !== undefined) return stack
      const next = stack.slice(0, pageIndex + 1)
      next[pageIndex + 1] = nextCursor
      return next
    })
    setPageIndex((current) => current + 1)
  }, [hasNext, nextCursor, pageIndex])

  const goToPreviousPage = useCallback(() => {
    if (!hasPrevious) return
    setPageIndex((current) => current - 1)
  }, [hasPrevious])

  const refetch = useCallback(() => runFetch(true), [runFetch])

  const onTripClosed = useCallback(() => {
    if (pageIndex === 0) {
      runFetch(false)
      return
    }
    setHasNewHistory(true)
  }, [pageIndex, runFetch])

  useLiveResource('trip', 'any', onTripClosed, { kinds: ['trip_closed'] })

  const showNewHistory = useCallback(() => {
    setHasNewHistory(false)
    if (pageIndex === 0) {
      runFetch(false)
      return
    }
    setCursorStack([undefined])
    setPageIndex(0)
  }, [pageIndex, runFetch])

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
    hasNewHistory,
    goToNextPage,
    goToPreviousPage,
    refetch,
    showNewHistory,
  }
}
