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
  const fetchQueue = useCallback(
    () => api.get<TripExceptionListItem[]>('/api/v1/exceptions/review-queue'),
    [],
  )

  const { data, isLoading, error, refetch, refetchSilent } = useAsyncData<TripExceptionListItem[]>(
    fetchQueue,
    EMPTY,
  )

  useLiveResource('trip', 'any', refetchSilent, {
    kinds: ['exception_raised', 'exception_reviewed', 'exception_claimed'],
  })

  return { items: data, isLoading, error, refetch, refetchSilent }
}
