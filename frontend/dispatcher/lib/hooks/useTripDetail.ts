'use client'

import { api } from '@/lib/api/client'
import type { Trip } from '@shared/lib/types/trip'
import { useLiveResource } from '@/lib/realtime/useLiveResource'
import { useAsyncData } from './useAsyncData'

export interface UseTripDetailResult {
  trip: Trip | null
  isLoading: boolean
  error: string | null
  refetch: () => void
  // Refetches without flipping isLoading — used after a dispatcher mutation (cancel,
  // phase override) so the page's own content stays on screen instead of being
  // replaced by the full-page spinner mid-action.
  refetchSilent: () => void
}

export function useTripDetail(tripId: string): UseTripDetailResult {
  const { data, isLoading, error, refetch, refetchSilent } = useAsyncData<Trip | null>(
    () => api.get<Trip>(`/api/v1/trips/${tripId}`),
    null,
  )
  // Live: refetch in place (no spinner) whenever this trip changes — phase ticks,
  // exceptions, receipts appear without a reload.
  useLiveResource('trip', tripId, refetchSilent)
  return { trip: data, isLoading, error, refetch, refetchSilent }
}
