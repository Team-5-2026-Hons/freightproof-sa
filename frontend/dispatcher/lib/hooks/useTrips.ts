'use client'

import { useEffect, useMemo } from 'react'
import { api } from '@/lib/api/client'
import type { TripStatus, TripSummary } from '@shared/lib/types/trip'
import { useLiveResource } from '@/lib/realtime/useLiveResource'
import { TRIP_RECORD_KINDS } from '@/lib/realtime/types'
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

export const RECONCILE_INTERVAL_MS = 60_000

export function useTrips(filter?: TripsFilter): UseTripsResult {
  const { data: allTrips, isLoading, error, refetch, refetchSilent } = useAsyncData<TripSummary[]>(
    () => api.get<TripSummary[]>('/api/v1/trips'),
    EMPTY,
  )
  useLiveResource('trip', 'any', refetchSilent, { kinds: TRIP_RECORD_KINDS })

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refetchSilent()
    }, RECONCILE_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [refetchSilent])

  const statusKey = filter?.status?.join(',') ?? ''
  const driverId = filter?.driverId ?? ''
  const hasExceptions = filter?.hasExceptions

  const trips = useMemo(() => {
    return allTrips.filter(t => {
      if (filter?.status?.length && !filter.status.includes(t.status)) return false
      if (filter?.driverId && t.driver.id !== filter.driverId) return false
      if (hasExceptions !== undefined) {
        const hasNeedsReview = t.needs_review_count > 0
        if (hasExceptions !== hasNeedsReview) return false
      }
      return true
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTrips, statusKey, driverId, hasExceptions])

  return { trips, isLoading, error, refetch }
}
