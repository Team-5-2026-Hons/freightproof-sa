'use client'

// The signed-in driver's own trips, every status — GET /trips/me, or the mock fixtures in
// demo mode. One source for the Trips tabs and Home's record, so the two can never disagree
// about what the driver has done. Moved here unchanged from app/(app)/trips/page.tsx.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { mockTrips } from '@shared/lib/mocks/trips'
import { IS_DEMO_MODE } from '@/lib/constants/env'
import { useAuth } from '@/lib/hooks/useAuth'
import { fetchMyTrips } from '@/lib/api/trips'
import type { DriverTripSummary } from '@/lib/types/driver-trip'
import { tripsForDriver } from '@/lib/utils/trip-filters'

// Demo mode has no backend to call, so its rows are projected from the mock fixtures into
// the same DriverTripSummary shape the real endpoint returns — one row type downstream,
// so the tabs and filters below never branch on where the data came from.
function demoTripsFor(driverId: string): DriverTripSummary[] {
  return tripsForDriver(mockTrips, driverId as Parameters<typeof tripsForDriver>[1]).map((t) => ({
    id: t.id,
    trip_reference: t.trip_reference,
    status: t.status,
    trip_type: t.trip_type,
    origin_precinct_id: t.origin_precinct_id,
    destination_precinct_id: t.destination_precinct_id,
    origin_precinct_name: null,
    destination_precinct_name: null,
    planned_departure_at: t.planned_departure_at,
    actual_departure_at: t.actual_departure_at,
    planned_arrival_at: t.planned_arrival_at,
    actual_arrival_at: t.actual_arrival_at,
    // Unreviewed critical rows only, matching the backend's needs_review_count: every
    // exception starts needs_review, but the driver cannot review any of them.
    needs_review_count: t.exceptions.filter(
      (e) => e.review_status === 'needs_review' && e.severity === 'critical',
    ).length,
    created_at: t.created_at,
    updated_at: t.updated_at,
  }))
}

export interface MyTrips {
  trips: DriverTripSummary[]
  isLoading: boolean
  loadError: string | null
  /** Re-fetch, e.g. from a "Try Again" button. */
  reload: () => void
}

export function useMyTrips(): MyTrips {
  const { user } = useAuth()
  const [trips, setTrips] = useState<DriverTripSummary[]>([])
  const [isLoading, setIsLoading] = useState(!IS_DEMO_MODE)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Keyed on the driver's id, not the user OBJECT: AuthContext builds its provider value
  // inline, so useAuth() hands back a fresh reference on every render. Depending on the
  // object would make `load` a new function each render and re-fire the fetch effect in a
  // loop; a primitive id only changes when the signed-in driver actually changes.
  const driverId = user?.id ?? null

  const demoTrips = useMemo(
    () => (driverId !== null ? demoTripsFor(driverId) : []),
    [driverId],
  )

  const load = useCallback(() => {
    if (IS_DEMO_MODE) { setTrips(demoTrips); setIsLoading(false); return }
    if (driverId === null) { setTrips([]); setIsLoading(false); return }
    setIsLoading(true)
    setLoadError(null)
    fetchMyTrips()
      .then(setTrips)
      // Surfaced, never swallowed: an empty list and a failed fetch look identical
      // otherwise, and "no upcoming trips" is a lie when the request simply didn't land.
      .catch((err: unknown) => {
        console.error('Failed to load the driver\'s trips', err)
        setLoadError('Could not load your trips. Check your connection and try again.')
      })
      .finally(() => setIsLoading(false))
  }, [driverId, demoTrips])

  useEffect(() => { load() }, [load])

  return { trips, isLoading, loadError, reload: load }
}
