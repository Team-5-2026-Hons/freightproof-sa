'use client'

import { api } from '@/lib/api/client'
import type { Trip } from '@shared/lib/types/trip'
import { useAsyncData } from './useAsyncData'

export interface UseTripDetailResult {
  trip: Trip | null
  isLoading: boolean
  error: string | null
  refetch: () => void
}

export function useTripDetail(tripId: string): UseTripDetailResult {
  const { data, isLoading, error, refetch } = useAsyncData<Trip | null>(
    () => api.get<Trip>(`/api/v1/trips/${tripId}`),
    null,
  )
  return { trip: data, isLoading, error, refetch }
}
