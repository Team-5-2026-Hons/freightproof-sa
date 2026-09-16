'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '@/lib/api/client'
import type { ResolvedPeriod, TabQuery } from '@/lib/format/period'
import type {
  FleetActivity,
  FleetEvidence,
  FleetIncidents,
  FleetOnTime,
  FleetPatterns,
  FleetProblems,
  FleetReview,
  FleetRoutes,
  FleetTiles,
  Grain,
} from '@shared/lib/types/fleet-analytics'

export const FLEET_ANALYTICS_PATH = '/api/v1/analytics/fleet'

export interface FleetQueryResult<T> {
  data: T | null
  /** First load: nothing to show yet. */
  isLoading: boolean
  /** A newer request is in flight while `data` still holds the previous answer. */
  isRefreshing: boolean
  error: string | null
  refetch: () => void
}

interface FleetParams {
  /** null = All time: sent without a start (spec G11). */
  start: string | null
  end: string
  /** Trend endpoints only. */
  grain?: Grain
}

/** The request path for a fleet endpoint, or null while it can't be asked yet.
 *
 *  A trend over All time waits for the tiles' all_time_start: until the page knows where
 *  All time begins, it can't know whether the grain fits in 53 bars, and asking anyway could
 *  earn a 422 for a grain the page would have switched away from. */
export function fleetPath(endpoint: string, params: FleetParams, allTimeStart: string | null): string | null {
  if (params.grain !== undefined && params.start === null && allTimeStart === null) return null
  const search = new URLSearchParams()
  if (params.start !== null) search.set('start', params.start)
  search.set('end', params.end)
  if (params.grain !== undefined) search.set('grain', params.grain)
  return `${FLEET_ANALYTICS_PATH}/${endpoint}?${search.toString()}`
}

/** One fleet endpoint, refetched whenever `path` changes. A null path waits without asking.
 *
 * Modelled on useAnalyticsList (lib/hooks/useAnalytics.ts): the request is keyed on the path,
 * and a generation counter drops any reply that lands after a newer request. Two deliberate
 * differences (spec §7.4, §7.6):
 *   - the previous answer stays while a new period loads, so a chart dims instead of
 *     blanking and jumping;
 *   - a failed request clears it, so old numbers are never left on screen under a new period.
 */
export function useFleetQuery<T>(path: string | null): FleetQueryResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [isPending, setIsPending] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const generationRef = useRef(0)

  const runFetch = useCallback(() => {
    const generation = ++generationRef.current
    setIsPending(true)
    setError(null)
    if (path === null) return

    api.get<T>(path)
      .then((result) => {
        if (generationRef.current !== generation) return
        setData(result)
        setIsPending(false)
      })
      .catch((err: unknown) => {
        if (generationRef.current !== generation) return
        setData(null)
        setError(err instanceof Error ? err.message : 'An unexpected error occurred')
        setIsPending(false)
      })
  }, [path])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    runFetch()
    // Retire the in-flight request on unmount or path change, so it cannot land late.
    return () => { generationRef.current += 1 }
  }, [runFetch])

  return {
    data,
    isLoading: isPending && data === null,
    isRefreshing: isPending && data !== null,
    error,
    refetch: runFetch,
  }
}

/** The headline tiles. No parameters: they always describe the fleet right now. */
export function useFleetTiles(): FleetQueryResult<FleetTiles> {
  return useFleetQuery<FleetTiles>(`${FLEET_ANALYTICS_PATH}/tiles`)
}

/** Activity tab trends (charts 1.1 and 1.7), for the tab's own period and grain. */
export function useFleetActivity(query: TabQuery, allTimeStart: string | null): FleetQueryResult<FleetActivity> {
  return useFleetQuery<FleetActivity>(
    fleetPath('activity', { start: query.start, end: query.end, grain: query.grain }, allTimeStart),
  )
}

/** Busy patterns (chart 1.3), for the patterns' own period. No grain, so it never waits. */
export function useFleetPatterns(period: ResolvedPeriod): FleetQueryResult<FleetPatterns> {
  return useFleetQuery<FleetPatterns>(fleetPath('patterns', { start: period.start, end: period.end }, null))
}

/** A tab's trend endpoint for its own period and grain. */
function useFleetTrend<T>(endpoint: string, query: TabQuery, allTimeStart: string | null): FleetQueryResult<T> {
  return useFleetQuery<T>(fleetPath(endpoint, { start: query.start, end: query.end, grain: query.grain }, allTimeStart))
}

/** On time tab (charts 2.1, 2.2, 2.3, 2.5). */
export function useFleetOnTime(query: TabQuery, allTimeStart: string | null): FleetQueryResult<FleetOnTime> {
  return useFleetTrend<FleetOnTime>('on-time', query, allTimeStart)
}

/** Problems tab (charts 3.1–3.5). */
export function useFleetProblems(query: TabQuery, allTimeStart: string | null): FleetQueryResult<FleetProblems> {
  return useFleetTrend<FleetProblems>('problems', query, allTimeStart)
}

/** Review desk tab (charts 4.1–4.4). */
export function useFleetReview(query: TabQuery, allTimeStart: string | null): FleetQueryResult<FleetReview> {
  return useFleetTrend<FleetReview>('review', query, allTimeStart)
}

/** Evidence tab (charts 5.1, 5.2, 5.4, 5.7). */
export function useFleetEvidence(query: TabQuery, allTimeStart: string | null): FleetQueryResult<FleetEvidence> {
  return useFleetTrend<FleetEvidence>('evidence', query, allTimeStart)
}

/** Routes & sites tab: sites and lanes over the whole period. No grain, so it never waits. */
export function useFleetRoutes(period: ResolvedPeriod): FleetQueryResult<FleetRoutes> {
  return useFleetQuery<FleetRoutes>(fleetPath('routes', { start: period.start, end: period.end }, null))
}

/** Routes & sites tab: located reports for the incident map. */
export function useFleetIncidents(period: ResolvedPeriod): FleetQueryResult<FleetIncidents> {
  return useFleetQuery<FleetIncidents>(fleetPath('incidents', { start: period.start, end: period.end }, null))
}
