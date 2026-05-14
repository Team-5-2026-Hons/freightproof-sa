'use client'

import { useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api/client'
import type { TripStatus, TripSummary } from '@shared/lib/types/trip'

export interface TripsFilter {
  status?: TripStatus[]
  driverId?: string
  hasExceptions?: boolean
}

export function useTrips(filter?: TripsFilter): TripSummary[] {
  const [trips, setTrips] = useState<TripSummary[]>([])

  useEffect(() => {
    api.get<TripSummary[]>('/api/v1/trips')
      .then(setTrips)
      .catch(console.error)
  }, [])

  const statusKey = filter?.status?.join(',') ?? ''
  const driverId = filter?.driverId ?? ''
  const hasExceptions = filter?.hasExceptions

  return useMemo(() => {
    return trips.filter(t => {
      if (filter?.status?.length && !filter.status.includes(t.status)) return false
      if (filter?.driverId && t.driver.id !== filter.driverId) return false
      if (hasExceptions !== undefined) {
        const hasOpen = t.open_exception_count > 0
        if (hasExceptions !== hasOpen) return false
      }
      return true
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trips, statusKey, driverId, hasExceptions])
}
