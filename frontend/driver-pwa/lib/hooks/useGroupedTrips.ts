'use client'

import { useMemo } from 'react'
import { useMyTrips } from '@/lib/hooks/useMyTrips'
import { categorizeTrips, sortByDeparture } from '@/lib/utils/trip-filters'
import type { DriverTripSummary } from '@/lib/types/driver-trip'

export interface GroupedTrips {
  active: DriverTripSummary[]
  /** Soonest departure first: the next trip is the one a driver needs. */
  upcoming: DriverTripSummary[]
  /** Most recent first. */
  past: DriverTripSummary[]
  isLoading: boolean
  loadError: string | null
  reload: () => void
}

/** The driver's trips grouped and ordered once, shared by Trips and its "See all" lists. */
export function useGroupedTrips(): GroupedTrips {
  const { trips, isLoading, loadError, reload } = useMyTrips()
  const groups = useMemo(() => {
    const grouped = categorizeTrips(trips)
    return {
      active: sortByDeparture(grouped.active),
      upcoming: sortByDeparture(grouped.upcoming),
      past: sortByDeparture(grouped.past, 'latest-first'),
    }
  }, [trips])
  return { ...groups, isLoading, loadError, reload }
}
