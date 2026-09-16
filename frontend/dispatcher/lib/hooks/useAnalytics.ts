'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '@/lib/api/client'
import type { MonthRange } from '@/lib/types/month-range'
import type {
  DriverMetrics,
  FacilityMetrics,
  VehicleMetrics,
  VehicleStreak,
} from '@shared/lib/types/analytics'

const ANALYTICS_PATH = '/api/v1/analytics'

// Lanes are read by the fleet page's Routes & sites tab now (useFleetRoutes), not per month.
type MonthlyGrain = 'facilities' | 'vehicles' | 'drivers'

export interface AnalyticsResult<T> {
  rows: T[]
  isLoading: boolean
  error: string | null
  refetch: () => void
}

function monthlyPath(grain: MonthlyGrain, range: MonthRange): string {
  const params = new URLSearchParams({ start_month: range.start, end_month: range.end })
  return `${ANALYTICS_PATH}/${grain}?${params.toString()}`
}

/** One analytics list, refetched whenever `path` changes.
 *
 * Not built on useAsyncData: that hook never refetches when its fetcher changes, so a new
 * month range would keep showing the old one. This follows useTripHistory instead — the
 * request is keyed on the path, and a generation counter drops any response that arrives
 * after a newer request, so a slow reply for an old range never overwrites the current
 * one. */
function useAnalyticsList<T>(path: string): AnalyticsResult<T> {
  const [rows, setRows] = useState<T[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const generationRef = useRef(0)

  const runFetch = useCallback(() => {
    const generation = ++generationRef.current
    // A new range changes what the rows mean. Clear them up front so a failed request
    // can never leave the previous range's numbers on screen under the new range.
    setRows([])
    setIsLoading(true)
    setError(null)

    api.get<T[]>(path)
      .then((result) => {
        if (generationRef.current !== generation) return
        setRows(result)
        setIsLoading(false)
      })
      .catch((err: unknown) => {
        if (generationRef.current !== generation) return
        setError(err instanceof Error ? err.message : 'An unexpected error occurred')
        setIsLoading(false)
      })
  }, [path])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    runFetch()
    // Retire the in-flight request on unmount or path change, so it cannot land late.
    return () => { generationRef.current += 1 }
  }, [runFetch])

  return { rows, isLoading, error, refetch: runFetch }
}

export function useFacilityAnalytics(range: MonthRange): AnalyticsResult<FacilityMetrics> {
  return useAnalyticsList<FacilityMetrics>(monthlyPath('facilities', range))
}

export function useVehicleAnalytics(range: MonthRange): AnalyticsResult<VehicleMetrics> {
  return useAnalyticsList<VehicleMetrics>(monthlyPath('vehicles', range))
}

/** Whole-history streaks take no range, so changing the range never refetches them. */
export function useVehicleStreaks(): AnalyticsResult<VehicleStreak> {
  return useAnalyticsList<VehicleStreak>(`${ANALYTICS_PATH}/vehicles/streaks`)
}

export function useDriverAnalytics(range: MonthRange): AnalyticsResult<DriverMetrics> {
  return useAnalyticsList<DriverMetrics>(monthlyPath('drivers', range))
}
