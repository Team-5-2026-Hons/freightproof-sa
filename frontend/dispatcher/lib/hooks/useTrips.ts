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

// Publishing is best-effort (core/realtime.py logs and drops a failed publish), so a connected
// browser can miss an event and never learn of it. A slow periodic refetch bounds how stale the
// list can get. It runs whatever the stream's state: "API up, stream down" is exactly when it is
// the only thing keeping the list current. A minute keeps the load trivial for one list call.
export const RECONCILE_INTERVAL_MS = 60_000

export function useTrips(filter?: TripsFilter): UseTripsResult {
  const { data: allTrips, isLoading, error, refetch, refetchSilent } = useAsyncData<TripSummary[]>(
    () => api.get<TripSummary[]>('/api/v1/trips'),
    EMPTY,
  )
  // Live: any trip changing (new trip, phase, exception, close) refreshes the list in
  // place so status chips and needs-review counts stay current without a reload.
  // Evidence uploads change no list row, so they are filtered out; a reconnect still
  // refetches because useLiveResource does not apply the filter to that path.
  useLiveResource('trip', 'any', refetchSilent, { kinds: TRIP_RECORD_KINDS })

  // Skipped while the tab is hidden; on return the stream reconnects and that refetches anyway.
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
