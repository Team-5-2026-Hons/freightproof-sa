'use client'

import { useMemo } from 'react'
import { api } from '@/lib/api/client'
import type { TripStatus, TripSummary } from '@shared/lib/types/trip'
import { useAsyncData } from './useAsyncData'

export interface TripsFilter {
  status?: TripStatus[]
  driverId?: string
  hasExceptions?: boolean
}

export interface UseTripsResult {
  trips: TripSummary[]
  isLoading: boolean
  error: string | null
  refetch: () => void
}

const EMPTY: TripSummary[] = []

export function useTrips(filter?: TripsFilter): UseTripsResult {
  const { data: allTrips, isLoading, error, refetch } = useAsyncData<TripSummary[]>(
    () => api.get<TripSummary[]>('/api/v1/trips'),
    EMPTY,
  )

  const statusKey = filter?.status?.join(',') ?? ''
  const driverId = filter?.driverId ?? ''
  const hasExceptions = filter?.hasExceptions

  const trips = useMemo(() => {
    return allTrips.filter(t => {
      if (filter?.status?.length && !filter.status.includes(t.status)) return false
      if (filter?.driverId && t.driver.id !== filter.driverId) return false
      if (hasExceptions !== undefined) {
        const hasOpen = t.open_exception_count > 0
        if (hasExceptions !== hasOpen) return false
      }
      return true
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTrips, statusKey, driverId, hasExceptions])

  return { trips, isLoading, error, refetch }
}
