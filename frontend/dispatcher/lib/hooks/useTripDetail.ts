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
}

export function useTripDetail(tripId: string): UseTripDetailResult {
  const { data, isLoading, error, refetch, refetchSilent } = useAsyncData<Trip | null>(
    () => api.get<Trip>(`/api/v1/trips/${tripId}`),
    null,
  )
  // Live: refetch in place (no spinner) whenever this trip changes — phase ticks,
  // exceptions, receipts appear without a reload.
  useLiveResource('trip', tripId, refetchSilent)
  return { trip: data, isLoading, error, refetch }
}
