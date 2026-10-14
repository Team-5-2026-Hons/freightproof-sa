'use client'

import { useCallback, useRef, useState } from 'react'

import { api, ApiError } from '@/lib/api/client'
import { describeRoadCheck } from '@/lib/dev/presets'
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
  RigScenarioRequest,
  RigScenarioResponse,
  RoadCheckResponse,
  RoadFindingRead,
  ScanTriggerRequest,
  ScanTriggerResponse,
  WaypointRead,
} from '@/lib/types/dev'

const DEV_BASE = '/api/v1/dev'

// Enough for a whole demo run to stay on screen; older entries only add scrolling.
const MAX_ACTIVITY_ENTRIES = 20

export interface ActivityEntry {
  id: number
  at: string
  tone: 'ok' | 'error'
  text: string
  findings: RoadFindingRead[]
}

// Module scope rather than inside the hook, so `run`'s dependency list stays honest.
function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    return err.status === 404
      ? `${err.message} (is DEV_PANEL_ENABLED set on the backend?)`
      : err.message
  }
  return err instanceof Error ? err.message : String(err)
}

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
  // Every action's outcome, newest first — the panel's record of what the presenter did.
  activity: ActivityEntry[]
  runRigScenario: (body: RigScenarioRequest) => Promise<RigScenarioResponse | null>
  runRoadCheck: (tripId: string) => Promise<RoadCheckResponse | null>
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
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const nextActivityId = useRef(1)

  const log = useCallback((tone: ActivityEntry['tone'], text: string, findings: RoadFindingRead[] = []): void => {
    const entry: ActivityEntry = { id: nextActivityId.current++, at: new Date().toISOString(), tone, text, findings }
    setActivity(previous => [entry, ...previous].slice(0, MAX_ACTIVITY_ENTRIES))
  }, [])

  // `describe` returning null means "this call has nothing to say" — used by the
  // silent refresh below, which must not overwrite the message from the action
  // that triggered it. Every message and every failure also lands in the activity log;
  // `findingsOf` attaches the exceptions a road check newly recorded to its entry.
  const run = useCallback(async <T,>(
    action: () => Promise<T>,
    describe: (result: T) => string | null,
    findingsOf?: (result: T) => RoadFindingRead[],
  ): Promise<T | null> => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await action()
      const message = describe(result)
      if (message !== null) {
        setLastResult(message)
        log('ok', message, findingsOf ? findingsOf(result) : [])
      }
      return result
    } catch (err: unknown) {
      const message = describeError(err)
      setError(message)
      log('error', message)
      return null
    } finally {
      setIsLoading(false)
    }
  }, [log])

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
          // geofence_confirmed is null (not false) on the no_signal waypoint/scenario
          // — a missing fix never reached a verdict at all, which reads very
          // differently from a fix that reached one and failed it.
          const verdict = result.geofence_confirmed === null
            ? 'no verdict (tracker dark)'
            : result.geofence_confirmed ? 'geofence confirmed' : 'geofence failed'
          // FP-197: scenario mode names a real target stop; legacy waypoints
          // don't, so target_precinct_name is null for them and this suffix is empty.
          // The verdict itself always describes the EXPECTED (phase-ledger) stop —
          // named explicitly here so the toast can never read as if it graded the
          // scenario-mode target instead.
          const targetSuffix = result.target_precinct_name !== null
            ? ` (targeted ${result.target_precinct_name})`
            : ''
          const expectedName = result.expected_precinct_name ?? result.precinct_name
          return `Moved truck to "${result.waypoint_label}"${targetSuffix}: ${verdict} at expected stop ${expectedName}.`
        },
      ),
    [run],
  )

  const newFindings = (result: RoadCheckResponse): RoadFindingRead[] =>
    result.findings.filter(f => f.newly_recorded)

  const runRigScenario = useCallback(
    (body: RigScenarioRequest) =>
      run(
        () => api.post<RigScenarioResponse>(`${DEV_BASE}/tracker/scenario`, body),
        (result) => `${result.label}. ${describeRoadCheck(result)}`,
        newFindings,
      ),
    [run],
  )

  const runRoadCheck = useCallback(
    (tripId: string) =>
      run(
        () => api.post<RoadCheckResponse>(`${DEV_BASE}/tracker/check`, { trip_id: tripId }),
        (result) => describeRoadCheck(result),
        newFindings,
      ),
    [run],
  )

  return {
    trips, waypoints, isLoading, error, lastResult, activity,
    loadTrips, triggerScan, closeScanSession, triggerPpChange, triggerException, flushMockState,
    loadWaypoints, moveTruck, runRigScenario, runRoadCheck,
  }
}
