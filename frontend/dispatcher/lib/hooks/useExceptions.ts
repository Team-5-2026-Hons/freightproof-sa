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
  // MUST be surfaced. An exception queue that fails to load renders identically to one
  // that is genuinely empty — and "no exceptions" is the single most reassuring thing
  // this screen can say. Showing it because a fetch failed is the worst error this page
  // can make.
  error: string | null
  refetch: () => void
  refetchSilent: () => void
}

/**
 * Every `needs_review` exception in the caller's organisation, newest first —
 * GET /api/v1/exceptions/review-queue. Unpaginated: this is a work queue a dispatcher
 * has to clear, not a browsable archive (that's useExceptionHistory).
 *
 * Takes no arguments, deliberately — the endpoint itself has no filters. The old
 * useExceptions() accepted (and silently ignored, via useAsyncData's ref-held fetch fn)
 * a `resolved` filter; that whole shape is gone with the endpoint it called.
 */
export function useExceptionQueue(): UseExceptionQueueResult {
  // Stable identity: useAsyncData refetches when this changes, and a new closure per
  // render would refetch on every render.
  const fetchQueue = useCallback(
    () => api.get<TripExceptionListItem[]>('/api/v1/exceptions/review-queue'),
    [],
  )

  const { data, isLoading, error, refetch, refetchSilent } = useAsyncData<TripExceptionListItem[]>(
    fetchQueue,
    EMPTY,
  )

  // Any trip, not one: this backs a queue spanning every trip in the organisation, so a
  // seal mismatch on a trip nobody is looking at still has to appear. Silent — the list
  // updates in place rather than flashing a spinner under someone reading it. Filtered
  // to exception kinds only: a phase tick or trip close elsewhere shouldn't re-poll a
  // queue whose membership didn't change.
  useLiveResource('trip', 'any', refetchSilent, {
    kinds: ['exception_raised', 'exception_reviewed'],
  })

  return { items: data, isLoading, error, refetch, refetchSilent }
}
