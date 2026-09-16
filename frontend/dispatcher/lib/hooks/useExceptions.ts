'use client'

import { useCallback } from 'react'

import { api } from '@/lib/api/client'
import { useLiveResource } from '@/lib/realtime/useLiveResource'
import type { TripExceptionListItem } from '@shared/lib/types/exception'
import { useAsyncData } from './useAsyncData'

const EMPTY: TripExceptionListItem[] = []

export interface UseExceptionQueueResult {
  items: TripExceptionListItem[]
  isLoading: boolean
  // MUST be surfaced: a failed load renders identically to a genuinely empty queue.
  error: string | null
  refetch: () => void
  refetchSilent: () => void
}

/**
 * Every `needs_review` exception in the caller's organisation, newest first —
 * GET /api/v1/exceptions/review-queue. Unpaginated: a work queue to clear, not a
 * browsable archive (that's useExceptionHistory). Takes no arguments; the endpoint
 * itself has no filters.
 */
export function useExceptionQueue(): UseExceptionQueueResult {
  // Stable identity, or a new closure per render would refetch every render.
  const fetchQueue = useCallback(
    () => api.get<TripExceptionListItem[]>('/api/v1/exceptions/review-queue'),
    [],
  )

  const { data, isLoading, error, refetch, refetchSilent } = useAsyncData<TripExceptionListItem[]>(
    fetchQueue,
    EMPTY,
  )

  // 'any' trip: this queue spans the whole org. Silent so it updates in place, not with
  // a spinner. Filtered to exception kinds so unrelated phase/close events don't re-poll it.
  useLiveResource('trip', 'any', refetchSilent, {
    kinds: ['exception_raised', 'exception_reviewed'],
  })

  return { items: data, isLoading, error, refetch, refetchSilent }
}
