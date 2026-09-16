"use client"

import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { Trip } from '@shared/lib/types/trip'
import type { PhaseStatus } from '@shared/lib/types/phase'
import type { TripException, ExceptionType } from '@shared/lib/types/exception'
import type { VehicleId, VehicleType } from '@shared/lib/types/vehicle'
import { mockTrips } from '@shared/lib/mocks/trips'
import { ROUTES } from '@/lib/constants/routes'
import { IS_DEMO_MODE } from '@/lib/constants/env'
import { TRIP_POLL_INTERVAL_MS } from '@/lib/constants/app'
import { fetchMyActiveTrip, fetchMyTrip } from '@/lib/api/trips'
import { ApiError } from '@/lib/api/client'
import { raiseException } from '@/lib/api/exceptions'
import { actionablePhase, contextPhaseEventId } from '@/lib/phase/derive'
import { useTripAutoRefresh } from '@/lib/hooks/useTripAutoRefresh'
import { AuthContext } from './AuthContext'
import { ToastContext } from './ToastContext'

// A trip in one of these states is finished and can no longer be the driver's working
// trip — mirrors the backend's `inactive` set in trip_service.get_active_trip_for_driver.
const TERMINAL_STATUSES: readonly Trip['status'][] = ['closed', 'cancelled']

// sessionStorage, not localStorage: a selection is a within-session intent and must not
// outlive the app being closed.
const SELECTED_TRIP_KEY = 'fp.selectedTripId'

// Demo mode mirrors what exception_service.pick_breakdown_vehicle decides server-side:
// the truck, the named trailer, or the trip's only trailer.
function demoBreakdownVehicleId(
  trip: Trip,
  type: ExceptionType,
  vehicleType: VehicleType | undefined,
  trailerId: string | undefined,
): VehicleId | null {
  if (type !== 'mechanical' || vehicleType === undefined) return null
  if (vehicleType === 'horse') return trip.horse?.id ?? null
  const named = trip.trailers.find((trailer) => String(trailer.id) === trailerId)
  if (named) return named.id
  const onlyTrailer = trip.trailers.length === 1 ? trip.trailers[0] : undefined
  return onlyTrailer?.id ?? null
}

function readSelectedTripId(): string | null {
  // Guarded for SSR/static-export prerender, where window does not exist.
  if (typeof window === 'undefined') return null
  return window.sessionStorage.getItem(SELECTED_TRIP_KEY)
}

// Mirrors lib/phase/derive.ts's RESOLVED_STATUSES by inversion: only a row the ledger
// still considers open may be optimistically advanced.
const UNRESOLVED_PHASE_STATUSES: readonly PhaseStatus[] = ['pending', 'in_progress']

// What an optimistically advanced phase reads as until the server's real answer lands.
const OPTIMISTIC_PHASE_STATUS: PhaseStatus = 'completed'

/**
 * The trip as the driver's screens should see it while a phase submission is in flight:
 * the addressed phase shown resolved. Purely local — replaced wholesale by `adoptTrip`.
 */
function withOptimisticResolution(trip: Trip | null, syncingPhaseIds: readonly string[]): Trip | null {
  if (trip === null || syncingPhaseIds.length === 0) return trip

  const syncing = new Set<string>(syncingPhaseIds)
  let changed = false
  const phases = trip.phases.map((phase) => {
    if (!syncing.has(phase.phase_event_id) || !UNRESOLVED_PHASE_STATUSES.includes(phase.status)) {
      return phase
    }
    changed = true
    return { ...phase, status: OPTIMISTIC_PHASE_STATUS }
  })

  // Identity preserved when nothing changed, so memoised consumers don't re-run.
  return changed ? { ...trip, phases } : trip
}

export interface TripState {
  trip: Trip | null
  isLoading: boolean
  exceptions: TripException[]
  logException: (type: ExceptionType, payload: Record<string, unknown>) => Promise<void>
  triggerPanic: () => void
  reset: () => void
  refetchTrip: () => Promise<Trip | null>
  // Points the phase flow at one specific trip — phase step pages can't take the trip
  // from the URL (output: 'export' can't enumerate trip UUIDs as path segments).
  selectTrip: (tripId: string) => Promise<Trip | null>
  // Adopts a trip the server just returned, without a second round trip — phase-complete
  // responses already carry the full updated plan.
  adoptTrip: (fresh: Trip) => void
  // Drop the selection and fall back to the server's choice (GET /trips/me/active).
  clearSelectedTrip: () => Promise<Trip | null>
  // phase_event_ids whose evidence is submitting in the background. `trip` already shows
  // them resolved — this is what lets a screen say "recording", not "recorded".
  syncingPhaseIds: readonly string[]
  // Optimistic advance while lib/submission/phase-submitter.ts's submission runs, so
  // Home doesn't re-offer the step just swiped.
  markPhaseSyncing: (phaseEventId: string) => void
  // Drops the marker. After adoptTrip(fresh) it reconciles; called on its own it rolls
  // back so the driver can re-enter the step with their draft intact.
  clearPhaseSyncing: (phaseEventId: string) => void
  /** Refetch the trip WITHOUT touching isLoading. Never throws. No-op in demo mode. */
  refreshQuietly: () => Promise<void>
  /** True while a quiet refresh is in flight. For honest "checking…" UI only. */
  isRefreshing: boolean
  /** ISO timestamp of the last successful quiet refresh, or null if none yet. */
  lastRefreshedAt: string | null
}

export const TripContext = createContext<TripState | null>(null)

export function TripProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const authCtx = useContext(AuthContext)

  const mockTrip = useMemo(() => {
    if (!authCtx?.user) return null
    return (
      mockTrips.find(
        t => t.driver?.id === authCtx.user!.id && !['closed', 'cancelled'].includes(t.status),
      ) ?? null
    )
  }, [authCtx])

  // The plan exactly as the backend last stated it. Consumers read `trip` below instead —
  // this plus any in-flight optimistic advance — so a local guess is never mistaken for the ledger.
  const [serverTrip, setServerTrip] = useState<Trip | null>(null)
  const [syncingPhaseIds, setSyncingPhaseIds] = useState<readonly string[]>([])
  const trip = useMemo(
    () => withOptimisticResolution(serverTrip, syncingPhaseIds),
    [serverTrip, syncingPhaseIds],
  )
  const [isLoading, setIsLoading] = useState(!IS_DEMO_MODE)
  // Lazily seeded from sessionStorage so a mid-flow reload still addresses the chosen trip.
  const [selectedTripId, setSelectedTripId] = useState<string | null>(() => readSelectedTripId())

  const persistSelection = useCallback((tripId: string | null) => {
    if (typeof window !== 'undefined') {
      if (tripId === null) window.sessionStorage.removeItem(SELECTED_TRIP_KEY)
      else window.sessionStorage.setItem(SELECTED_TRIP_KEY, tripId)
    }
    setSelectedTripId(tripId)
  }, [])

  // Which trip the flow is on: an explicit selection wins, otherwise the server's own
  // pick. Single resolver so refetchTrip and the mount effect never disagree.
  const loadTrip = useCallback(async (): Promise<Trip | null> => {
    if (selectedTripId !== null) {
      try {
        const selected = await fetchMyTrip(selectedTripId)
        if (!TERMINAL_STATUSES.includes(selected.status)) return selected
        // A finished trip is no longer "the trip I'm on" — drop the pin and let the
        // server choose what's next.
        persistSelection(null)
      } catch (err) {
        // 404 means the trip is no longer this driver's — clear the selection. Any other
        // failure (offline, 5xx) is transient and must not strip it mid-journey.
        if (err instanceof ApiError && err.status === 404) persistSelection(null)
        else throw err
      }
    }
    return fetchMyActiveTrip()
  }, [selectedTripId, persistSelection])

  // Exposed for manual re-fetching. Not called directly inside the effect below — a
  // setState-containing callback called synchronously from an effect causes cascading
  // renders (same anti-pattern AuthContext.tsx avoids); the effect inlines its own fetch.
  const refetchTrip = useCallback(async () => {
    if (IS_DEMO_MODE) { setServerTrip(mockTrip); return mockTrip }
    if (!authCtx?.user) { setServerTrip(null); setIsLoading(false); return null }
    setIsLoading(true)
    try {
      const fetched = await loadTrip()
      setServerTrip(fetched)
      return fetched
    } finally {
      setIsLoading(false)
    }
  }, [authCtx?.user, mockTrip, loadTrip])

  // Pins the flow to one trip, then loads it. Awaited by callers so they only navigate
  // once the phase flow is pointed at it.
  const selectTrip = useCallback(async (tripId: string): Promise<Trip | null> => {
    if (IS_DEMO_MODE) { setServerTrip(mockTrip); return mockTrip }
    persistSelection(tripId)
    setIsLoading(true)
    try {
      const fetched = await fetchMyTrip(tripId)
      setServerTrip(fetched)
      return fetched
    } finally {
      setIsLoading(false)
    }
  }, [mockTrip, persistSelection])

  // Takes a server response only, never arbitrary state, so the context can't drift into
  // a locally-invented trip — the phase flow's sequencing guard trusts trip.phases here.
  const adoptTrip = useCallback((fresh: Trip) => {
    setServerTrip(fresh)
    setIsLoading(false)
  }, [])

  const markPhaseSyncing = useCallback((phaseEventId: string) => {
    setSyncingPhaseIds((prev) => (prev.includes(phaseEventId) ? prev : [...prev, phaseEventId]))
  }, [])

  const clearPhaseSyncing = useCallback((phaseEventId: string) => {
    setSyncingPhaseIds((prev) => (prev.includes(phaseEventId) ? prev.filter((id) => id !== phaseEventId) : prev))
  }, [])

  const clearSelectedTrip = useCallback(async (): Promise<Trip | null> => {
    if (IS_DEMO_MODE) { setServerTrip(mockTrip); return mockTrip }
    persistSelection(null)
    setIsLoading(true)
    try {
      const fetched = await fetchMyActiveTrip()
      setServerTrip(fetched)
      return fetched
    } finally {
      setIsLoading(false)
    }
  }, [mockTrip, persistSelection])

  // Optional: some test harnesses render TripProvider without a ToastProvider ancestor,
  // where useToast() would throw. Reading the context directly keeps the toast a no-op there.
  const toastCtx = useContext(ToastContext)

  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null)

  // Distinct from refetchTrip: must never set isLoading (screens blank to a spinner on
  // that flag). Writes serverTrip only, so withOptimisticResolution keeps re-layering
  // syncingPhaseIds on top — a poll mid-submission must not un-complete a swiped phase.
  const refreshQuietly = useCallback(async (): Promise<void> => {
    if (IS_DEMO_MODE) return
    if (!authCtx?.user) return

    setIsRefreshing(true)
    try {
      const fetched = await loadTrip()
      setServerTrip(fetched)
      setLastRefreshedAt(new Date().toISOString())
      // Unblock toast deliberately not raised here — see the gate-transition effect below.
    } catch (err) {
      // Never surfaced or rethrown: the polling interval calls this directly, and a
      // rejection every tick would be its own kind of harassment. Logged for visibility.
      console.error('Quiet trip refresh failed', err)
    } finally {
      setIsRefreshing(false)
    }
  }, [authCtx?.user, loadTrip])

  // Derived fresh every render from `trip`, never cached — must flip false the instant
  // the server's recomputation says so.
  const actionable = trip !== null ? actionablePhase(trip.phases) : null
  // `?? null` first is mandatory: `blocked_on` is optional, so `undefined !== null` would
  // be permanently true and polling would never turn off.
  const pollingEnabled =
    trip !== null &&
    ((actionable?.blocked_on ?? null) !== null || trip.status === 'exception_hold')

  useTripAutoRefresh({
    pollingEnabled,
    intervalMs: TRIP_POLL_INTERVAL_MS,
    onRefresh: refreshQuietly,
  })

  // Watches the RENDERED plan rather than living inside refreshQuietly, since other paths
  // (409 handler, adoptTrip, selectTrip) replace the trip too and a refresh-local ref
  // would go stale on them. Keying off the actionable phase's identity as well as its
  // gate means a different phase or trip re-seeds instead of reading as this one clearing.
  const actionablePhaseEventId = actionable !== null ? String(actionable.phase_event_id) : null
  const actionableBlockedOn = actionable?.blocked_on ?? null
  const previousGateRef = useRef<{ phaseEventId: string | null; blockedOn: string | null } | null>(null)

  useEffect(() => {
    const previous = previousGateRef.current
    previousGateRef.current = { phaseEventId: actionablePhaseEventId, blockedOn: actionableBlockedOn }

    // First observation seeds only — a trip that loads already unblocked never transitioned.
    if (previous === null) return
    // A different phase, or a different trip, is a new subject rather than this one clearing.
    if (previous.phaseEventId !== actionablePhaseEventId) return
    if (previous.blockedOn === null || actionableBlockedOn !== null) return

    // notify() is an event sink, not derived state — a deliberate exception to the
    // no-setState-in-effect pattern elsewhere in this file; the card clears silently otherwise.
    toastCtx?.notify({
      kind: 'info',
      title: 'You can continue',
      body: 'The warehouse has finished — this step is ready.',
    })
  }, [actionablePhaseEventId, actionableBlockedOn, toastCtx])

  useEffect(() => {
    // No synchronous setState here, even for demo/no-user — matches AuthContext.tsx's
    // mount effect, avoiding the cascading-render anti-pattern.
    if (IS_DEMO_MODE) {
      Promise.resolve().then(() => setServerTrip(mockTrip))
      return
    }
    if (!authCtx?.user) {
      Promise.resolve().then(() => { setServerTrip(null); setIsLoading(false) })
      return
    }

    Promise.resolve().then(() => setIsLoading(true))
    loadTrip()
      .then(setServerTrip)
      // A rejected fetch here otherwise leaves isLoading stuck true (a frozen screen).
      // Log and leave trip null so "no active trip" renders instead.
      .catch((err: unknown) => {
        console.error('Failed to load the driver\'s current trip', err)
        setServerTrip(null)
      })
      .finally(() => setIsLoading(false))
  }, [authCtx?.user, mockTrip, loadTrip])

  const [exceptions, setExceptions] = useState<TripException[]>([])
  // Tracks which trip's initial state has been applied — resets derived state
  // synchronously during render instead of via a useEffect + setState.
  const [syncedTripId, setSyncedTripId] = useState<string | null>(null)

  if (trip !== null && (trip.id as string) !== syncedTripId) {
    setSyncedTripId(trip.id as string)
    setExceptions(trip.exceptions)
  }

  const logException = useCallback(async (type: ExceptionType, payload: Record<string, unknown>) => {
    if (!trip) return
    const description = typeof payload.description === 'string' ? payload.description : ''
    const supportingArtifactId = typeof payload.supporting_artifact_id === 'string' ? payload.supporting_artifact_id : undefined
    const clientReportId = typeof payload.clientReportId === 'string'
      ? payload.clientReportId
      : crypto.randomUUID()
    // Both-or-neither: the backend's validator 422s a partial fix, so a lone axis (or a
    // non-number) is treated as no fix at all.
    const gpsLat = typeof payload.gpsLat === 'number' ? payload.gpsLat : undefined
    const gpsLng = typeof payload.gpsLng === 'number' ? payload.gpsLng : undefined
    const hasGpsFix = gpsLat !== undefined && gpsLng !== undefined
    // Only the two real kinds pass; anything else goes as no answer, which the server
    // records as no vehicle rather than rejecting the report.
    const rawVehicleType = payload.vehicleType
    const vehicleType: VehicleType | undefined =
      rawVehicleType === 'horse' || rawVehicleType === 'trailer' ? rawVehicleType : undefined
    const trailerId = typeof payload.trailerId === 'string' ? payload.trailerId : undefined

    // WHERE this happened. Read off `trip` (the optimistic plan), not serverTrip: a
    // driver who just swiped departure is on the road even while the submission is in flight.
    const phaseEventId = contextPhaseEventId(trip.phases)

    if (IS_DEMO_MODE) {
      const criticalTypes: ExceptionType[] = ['panic_button', 'seal_broken_in_transit', 'seal_mismatch']
      const newExc: TripException = {
        id: crypto.randomUUID() as unknown as TripException['id'],
        trip_id: trip.id, exception_type: type, source: 'driver',
        severity: criticalTypes.includes(type) ? 'critical' : 'warning',
        description,
        // Same tagging the real branch sends, so demo mode exercises the shape the
        // dispatcher timeline reads.
        phase_event_id: phaseEventId, checkpoint_id: null, supporting_artifact_id: null,
        gps_lat: hasGpsFix ? gpsLat : null,
        gps_lng: hasGpsFix ? gpsLng : null,
        vehicle_id: demoBreakdownVehicleId(trip, type, vehicleType, trailerId),
        // Mirrors backend initial_review_status: CRITICAL starts needs_review, else recorded.
        review_status: criticalTypes.includes(type) ? 'needs_review' : 'recorded',
        review_outcome: null, reviewed_by_user_id: null,
        reviewed_at: null, review_note: null, contact_method: null,
        merkle_batch_id: null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }
      setExceptions(prev => [...prev, newExc])
      return
    }

    const created = await raiseException(String(trip.id), {
      exception_type: type, description, supporting_artifact_id: supportingArtifactId,
      client_report_id: clientReportId,
      ...(phaseEventId ? { phase_event_id: String(phaseEventId) } : {}),
      ...(vehicleType ? { vehicle_type: vehicleType } : {}),
      ...(trailerId ? { trailer_id: trailerId } : {}),
      gps_lat: hasGpsFix ? gpsLat : undefined,
      gps_lng: hasGpsFix ? gpsLng : undefined,
    })
    setExceptions(prev => [...prev, created])
  }, [trip])

  const triggerPanic = useCallback(() => {
    if (!trip) return
    router.push(ROUTES.panic)
  }, [trip, router])

  const reset = useCallback(() => {
    if (!trip) return
    setExceptions(trip.exceptions)
  }, [trip])

  return (
    <TripContext.Provider
      value={{
        trip, isLoading, exceptions,
        logException, triggerPanic, reset, refetchTrip,
        selectTrip, clearSelectedTrip, adoptTrip,
        syncingPhaseIds, markPhaseSyncing, clearPhaseSyncing,
        refreshQuietly, isRefreshing, lastRefreshedAt,
      }}
    >
      {children}
    </TripContext.Provider>
  )
}
