'use client'

import { useEffect, useMemo } from 'react'
import { useTrips } from '@/lib/hooks/useTrips'
import { usePrecincts } from '@/lib/hooks/usePrecincts'
import { useToast } from '@/lib/hooks/useToast'
import { isActiveTrip } from '@/lib/trips/active'
import { putTripSeeds } from '@/lib/trips/tripSeed'
import type { Precinct } from '@shared/lib/types/precinct'
import type { TripSummary } from '@shared/lib/types/trip'

export interface UseActiveTripsResult {
  trips: TripSummary[]
  precincts: Precinct[]
  initialLoad: boolean
  loadFailed: boolean
  error: string | null
  refetch: () => void
}

/** The dispatcher's live trips, shared by the Active Trips page and the dashboard's Needs action
 *  panel: one fetch, the active-status filter, the detail-page seeds and the error toasts. */
export function useActiveTrips(): UseActiveTripsResult {
  const { notify } = useToast()
  const { trips: fetched, isLoading, error, refetch } = useTrips()
  const { precincts, error: precinctsError } = usePrecincts()

  useEffect(() => { putTripSeeds(fetched) }, [fetched])

  useEffect(() => {
    if (error) notify({ kind: 'error', title: 'Failed to load trips', body: error })
  }, [error, notify])

  useEffect(() => {
    if (precinctsError) {
      notify({
        kind: 'error',
        title: 'Failed to load precincts',
        body: `${precinctsError} Origin and destination names may be missing.`,
      })
    }
  }, [precinctsError, notify])

  const trips = useMemo(() => fetched.filter(isActiveTrip), [fetched])

  return {
    trips,
    precincts,
    initialLoad: isLoading && fetched.length === 0,
    loadFailed: !!error && fetched.length === 0,
    error,
    refetch,
  }
}
