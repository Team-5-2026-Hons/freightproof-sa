'use client'

import { useCallback, useState } from 'react'

import { api, ApiError } from '@/lib/api/client'
import type {
  CloseScanSessionRequest,
  CloseScanSessionResponse,
  DevTripSummary,
  ExceptionTriggerRequest,
  ExceptionTriggerResponse,
  FlushMockStateResponse,
  MoveTruckRequest,
  MoveTruckResponse,
  PpTriggerRequest,
  PpTriggerResponse,
  ScanTriggerRequest,
  ScanTriggerResponse,
  WaypointRead,
} from '@/lib/types/dev'

const DEV_BASE = '/api/v1/dev'

export interface UseDevTriggersResult {
  trips: DevTripSummary[]
  waypoints: WaypointRead[]
  isLoading: boolean
  error: string | null
  lastResult: string | null
  loadTrips: (options?: { readonly silent?: boolean }) => Promise<void>
  triggerScan: (body: ScanTriggerRequest) => Promise<ScanTriggerResponse | null>
  closeScanSession: (body: CloseScanSessionRequest) => Promise<CloseScanSessionResponse | null>
  triggerPpChange: (body: PpTriggerRequest) => Promise<PpTriggerResponse | null>
  triggerException: (body: ExceptionTriggerRequest) => Promise<ExceptionTriggerResponse | null>
  flushMockState: () => Promise<FlushMockStateResponse | null>
  loadWaypoints: () => Promise<void>
  moveTruck: (body: MoveTruckRequest) => Promise<MoveTruckResponse | null>
}

/**
 * Calls the dev trigger endpoints. Every failure is surfaced as readable text
 * rather than swallowed — an unexplained no-op mid-demo is the worst outcome,
 * and a 404 here usually means DEV_PANEL_ENABLED is not set on the backend.
 */
export function useDevTriggers(): UseDevTriggersResult {
  const [trips, setTrips] = useState<DevTripSummary[]>([])
  const [waypoints, setWaypoints] = useState<WaypointRead[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<string | null>(null)

  const describeError = (err: unknown): string => {
    if (err instanceof ApiError) {
      return err.status === 404
        ? `${err.message} (is DEV_PANEL_ENABLED set on the backend?)`
        : err.message
    }
    return err instanceof Error ? err.message : String(err)
  }

  // `describe` returning null means "this call has nothing to say" — used by the
  // silent refresh below, which must not overwrite the message from the action
  // that triggered it.
  const run = useCallback(async <T,>(
    action: () => Promise<T>,
    describe: (result: T) => string | null,
  ): Promise<T | null> => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await action()
      const message = describe(result)
      if (message !== null) setLastResult(message)
      return result
    } catch (err: unknown) {
      setError(describeError(err))
      return null
    } finally {
      setIsLoading(false)
    }
  }, [])

  const loadTrips = useCallback(async (options?: { readonly silent?: boolean }): Promise<void> => {
    await run(
      () => api.get<DevTripSummary[]>(`${DEV_BASE}/trips`),
      (result) => {
        setTrips(result)
        // A silent refresh follows a scan or close-session, whose own summary
        // (missing/unexpected counts) is what the operator needs to read.
        // "Loaded N trip(s)" would bury it. Errors still surface either way.
        return options?.silent === true ? null : `Loaded ${result.length} trip(s).`
      },
    )
  }, [run])

  const triggerScan = useCallback(
    (body: ScanTriggerRequest) =>
      run(
        () => api.post<ScanTriggerResponse>(`${DEV_BASE}/scans`, body),
        (result) => {
          const missing = result.consignments.reduce((n, c) => n + c.missing_barcodes.length, 0)
          const unexpected = result.consignments.reduce((n, c) => n + c.unexpected_barcodes.length, 0)
          const scanned = result.consignments.reduce((n, c) => n + c.observed_count, 0)
          return `Scanned ${scanned}. Missing ${missing}. Unexpected ${unexpected}.`
        },
      ),
    [run],
  )

  const closeScanSession = useCallback(
    (body: CloseScanSessionRequest) =>
      run(
        () => api.post<CloseScanSessionResponse>(`${DEV_BASE}/scans/close-session`, body),
        (result) => {
          const directionLabel = result.direction === 'out' ? 'loading' : 'unloading'
          return (
            `Closed ${result.sessions_closed} scan session(s) for ${directionLabel}. ` +
            `The driver's phase is now unblocked.`
          )
        },
      ),
    [run],
  )

  const triggerPpChange = useCallback(
    (body: PpTriggerRequest) =>
      run(
        () => api.post<PpTriggerResponse>(`${DEV_BASE}/pp/waybill`, body),
        (result) =>
          `${result.parcel_perfect_reference}: expected ${result.parcel_count_expected}, ` +
          `manifest ${result.pp_manifest_number ?? 'none'}.`,
      ),
    [run],
  )

  const triggerException = useCallback(
    (body: ExceptionTriggerRequest) =>
      run(
        () => api.post<ExceptionTriggerResponse>(`${DEV_BASE}/exceptions`, body),
        (result) => `Raised ${result.exception_type} (${result.severity}).`,
      ),
    [run],
  )

  const flushMockState = useCallback(
    () =>
      run(
        () => api.post<FlushMockStateResponse>(`${DEV_BASE}/mock-state/flush`, {}),
        (result) => `Cleared ${result.keys_deleted} staged key(s). Evidence untouched.`,
      ),
    [run],
  )

  const loadWaypoints = useCallback(async (): Promise<void> => {
    await run(
      () => api.get<WaypointRead[]>(`${DEV_BASE}/pulsit/waypoints`),
      (result) => {
        setWaypoints(result)
        // Silent: this fires on mount, and "Loaded 6 waypoint(s)" would bury
        // whatever the operator was actually doing when the panel first rendered.
        return null
      },
    )
  }, [run])

  const moveTruck = useCallback(
    (body: MoveTruckRequest) =>
      run(
        () => api.post<MoveTruckResponse>(`${DEV_BASE}/pulsit/move-truck`, body),
        (result) => {
          // geofence_confirmed is null (not false) on the no_signal waypoint — a
          // missing fix never reached a verdict at all, which reads very differently
          // from a fix that reached one and failed it.
          const verdict = result.geofence_confirmed === null
            ? 'no verdict (tracker dark)'
            : result.geofence_confirmed ? 'geofence confirmed' : 'geofence failed'
          return `Moved truck to "${result.waypoint_label}": ${verdict}.`
        },
      ),
    [run],
  )

  return {
    trips, waypoints, isLoading, error, lastResult,
    loadTrips, triggerScan, closeScanSession, triggerPpChange, triggerException, flushMockState,
    loadWaypoints, moveTruck,
  }
}
