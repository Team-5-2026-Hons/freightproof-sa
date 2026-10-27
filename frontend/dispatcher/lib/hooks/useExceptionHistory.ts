'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import type { ExceptionHistoryNavigation } from '@/lib/exceptions/view-state'
import { api } from '@/lib/api/client'
import type {
  ExceptionReviewStatus,
  ExceptionSeverity,
  TripExceptionListItem,
} from '@shared/lib/types/exception'
import type { CursorPage } from '@shared/lib/types/pagination'
import { readPreferences } from '@/lib/preferences'

const EMPTY: TripExceptionListItem[] = []
const FIRST_CURSOR_STACK: (string | undefined)[] = [undefined]

export interface ExceptionHistoryFilters {
  q?: string
  reviewStatus?: ExceptionReviewStatus
  severity?: ExceptionSeverity
  fromDate?: string
  toDate?: string
}

export interface UseExceptionHistoryResult {
  items: TripExceptionListItem[]
  isLoading: boolean
  error: string | null
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

function buildQuery(filters: ExceptionHistoryFilters, cursor: string | undefined, pageSize: number): string {
  const params = new URLSearchParams()
  params.set('limit', String(pageSize))
  if (cursor) params.set('cursor', cursor)
  if (filters.q) params.set('q', filters.q)
  if (filters.reviewStatus) params.set('review_status', filters.reviewStatus)
  if (filters.severity) params.set('severity', filters.severity)
  if (filters.fromDate) params.set('from_date', filters.fromDate)
  if (filters.toDate) params.set('to_date', filters.toDate)
  return `/api/v1/exceptions/history?${params.toString()}`
}

/**
 * The dispatcher's browsable exception archive, GET /api/v1/exceptions/history,
 * cursor-paginated. Doesn't use useAsyncData: that hook can't express "changing a filter
 * jumps back to page 1", so this owns its own fetch effect guarded by a
 * request-generation counter (a superseded request can never overwrite a newer result).
 *
 * No realtime subscription: unlike the review queue this is a static archive a dispatcher
 * is actively paging through, and a live update mid-scroll would reorder pages underfoot.
 */
export function useExceptionHistory(filters: ExceptionHistoryFilters, navigation?: ExceptionHistoryNavigation): UseExceptionHistoryResult {
  const [items, setItems] = useState<TripExceptionListItem[]>(EMPTY)
  const [totalItems, setTotalItems] = useState(0)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isStale, setIsStale] = useState(false)
  const [pageSize] = useState(() => readPreferences().rowsPerPage)

  const [localCursorStack, setCursorStack] = useState<(string | undefined)[]>([undefined])
  const [localPageIndex, setPageIndex] = useState(0)

  const [controlledPageReset, setControlledPageReset] = useState(false)
  if (controlledPageReset && navigation?.pageIndex === 0) setControlledPageReset(false)
  const pageSizeChanged = !!navigation && navigation.cursorStack.length > 1 && navigation.pageSize !== pageSize
  const resetNavigation = controlledPageReset || pageSizeChanged
  const cursorStack = resetNavigation ? FIRST_CURSOR_STACK : navigation?.cursorStack ?? localCursorStack
  const pageIndex = resetNavigation ? 0 : navigation?.pageIndex ?? localPageIndex

  const q = filters.q ?? ''
  const reviewStatus = filters.reviewStatus ?? ''
  const severity = filters.severity ?? ''
  const fromDate = filters.fromDate ?? ''
  const toDate = filters.toDate ?? ''
  const filterKey = JSON.stringify([q, reviewStatus, severity, fromDate, toDate])

  const [prevFilterKey, setPrevFilterKey] = useState(filterKey)
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey)
    if (navigation && navigation.pageIndex > 0) setControlledPageReset(true)
    setCursorStack([undefined])
    setPageIndex(0)
  }

  const controlledFilterRef = useRef(filterKey)
  useEffect(() => {
    const filtersChanged = controlledFilterRef.current !== filterKey
    controlledFilterRef.current = filterKey
    if (filtersChanged || pageSizeChanged) {
      navigation?.onChange({ cursorStack: [undefined], pageIndex: 0, pageSize })
    }
  }, [filterKey, navigation, pageSizeChanged, pageSize])

  const requestGenerationRef = useRef(0)
  const hasSuccessfulResultRef = useRef(false)
  const cursor = filterKey !== prevFilterKey ? undefined : cursorStack[pageIndex]

  const runFetch = useCallback((preserveCurrentResult: boolean) => {
    const generation = ++requestGenerationRef.current
    const canRetainStaleResult = preserveCurrentResult && hasSuccessfulResultRef.current
    setIsLoading(true)
    setError(null)
    if (!preserveCurrentResult) {
      setItems(EMPTY)
      setTotalItems(0)
      setNextCursor(null)
      setIsStale(false)
      hasSuccessfulResultRef.current = false
    }

    api.get<CursorPage<TripExceptionListItem>>(buildQuery(filters, cursor, pageSize))
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
        setError(err instanceof Error ? err.message : 'An unexpected error occurred')
        setIsStale(canRetainStaleResult)
        setIsLoading(false)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, cursor, pageSize])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    runFetch(false)
  }, [runFetch])

  const hasPrevious = pageIndex > 0
  const hasNext = nextCursor !== null

  const goToNextPage = useCallback(() => {
    if (!hasNext || nextCursor === null) return
    const next = cursorStack.slice(0, pageIndex + 1)
    next[pageIndex + 1] = nextCursor
    if (navigation) navigation.onChange({ cursorStack: next, pageIndex: pageIndex + 1, pageSize })
    else { setCursorStack(next); setPageIndex(pageIndex + 1) }
  }, [hasNext, nextCursor, pageIndex, cursorStack, navigation, pageSize])

  const goToPreviousPage = useCallback(() => {
    if (!hasPrevious) return
    if (navigation) navigation.onChange({ cursorStack, pageIndex: pageIndex - 1, pageSize })
    else setPageIndex(i => i - 1)
  }, [hasPrevious, navigation, cursorStack, pageIndex, pageSize])

  const refetch = useCallback(() => runFetch(true), [runFetch])

  return {
    items,
    isLoading,
    error,
    isStale,
    totalItems,
    page: pageIndex + 1,
    pageSize,
    hasPrevious,
    hasNext,
    goToNextPage,
    goToPreviousPage,
    refetch,
  }
}
