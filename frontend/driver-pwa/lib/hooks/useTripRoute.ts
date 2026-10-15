'use client'

// The planned truck route for one trip, fetched once per trip id. Every failure — offline,
// no ORS key on the server, demo mode with no backend — resolves to null, and the driving
// screen keeps showing the planned arrival time. A missing route never blocks anything.

import { useEffect, useState } from 'react'
import { IS_DEMO_MODE } from '@/lib/constants/env'
import { fetchMyTripRoute } from '@/lib/api/trips'
import type { TripRoute } from '@/lib/types/route'

export function useTripRoute(tripId: string | null): TripRoute | null {
  const [route, setRoute] = useState<TripRoute | null>(null)

  useEffect(() => {
    setRoute(null)
    // Demo trips are mock fixtures with no server-side stops to route between.
    if (tripId === null || IS_DEMO_MODE) return

    let cancelled = false
    fetchMyTripRoute(tripId)
      .then((next) => { if (!cancelled) setRoute(next) })
      .catch((err: unknown) => {
        // Display-only: logged for diagnosis, never surfaced as an error on the road.
        console.warn('[useTripRoute] route unavailable', err)
      })
    return () => { cancelled = true }
  }, [tripId])

  return route
}
