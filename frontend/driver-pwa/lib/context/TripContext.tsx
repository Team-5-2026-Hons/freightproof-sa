"use client"

import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react'
import type { Trip } from '@shared/lib/types/trip'
import type { PhaseDescriptor, PhaseStatus } from '@shared/lib/types/phase'
import type { TripException, ExceptionType } from '@shared/lib/types/exception'
import type { VehicleId, VehicleType } from '@shared/lib/types/vehicle'
import { mockTrips } from '@shared/lib/mocks/trips'
import { IS_DEMO_MODE } from '@/lib/constants/env'
import { TRIP_POLL_INTERVAL_MS, UNASSIGNED_TRIP_POLL_INTERVAL_MS } from '@/lib/constants/app'
import { fetchMyActiveTrip, fetchMyTrip } from '@/lib/api/trips'
import { ApiError } from '@/lib/api/client'
import { isTripHandedOver } from '@/lib/api/driver-substitutions'
import { raiseException } from '@/lib/api/exceptions'
import { actionablePhase, contextPhaseEventId } from '@/lib/phase/derive'
import { useTripAutoRefresh } from '@/lib/hooks/useTripAutoRefresh'
import { actorGeneration, captureCustody, setCustodyContext } from '@/lib/session/custody-context'
import { useAccountGuard } from '@/lib/session/useAccountGuard'
import { AuthContext } from './AuthContext'
import { ToastContext } from './ToastContext'

const TERMINAL_STATUSES: readonly Trip['status'][] = ['closed', 'cancelled']

const SELECTED_TRIP_KEY = 'fp.selectedTripId'

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
  if (typeof window === 'undefined') return null
  return window.sessionStorage.getItem(SELECTED_TRIP_KEY)
}

const UNRESOLVED_PHASE_STATUSES: readonly PhaseStatus[] = ['pending', 'in_progress']

const OPTIMISTIC_PHASE_STATUS: PhaseStatus = 'completed'

/**
 * The trip as the driver's screens should see it while a phase submission is still in
 * flight: the addressed phase shown resolved, so Home does not re-offer the step the
 * driver has just finished swiping. Purely local and purely transient — it is never
 * persisted, never sent anywhere, and is replaced wholesale by `adoptTrip` the moment
 * the backend answers.
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

  return changed ? { ...trip, phases } : trip
}

export interface TripState {
  trip: Trip | null
  isLoading: boolean
  exceptions: TripException[]
  logException: (type: ExceptionType, payload: Record<string, unknown>) => Promise<void>
  refetchTrip: () => Promise<Trip | null>
  selectTrip: (tripId: string) => Promise<Trip | null>
  adoptTrip: (fresh: Trip) => void
  clearSelectedTrip: () => Promise<Trip | null>
  syncingPhaseIds: readonly string[]
  markPhaseSyncing: (phaseEventId: string) => void
  clearPhaseSyncing: (phaseEventId: string) => void
  /** Refetch the trip WITHOUT touching isLoading. Never throws. No-op in demo mode. */
  refreshQuietly: () => Promise<void>
  isRefreshing: boolean
  lastRefreshedAt: string | null
  handedOverTripId: string | null
  noteTripHandedOver: (tripId: string) => void
  dismissHandedOver: () => void
  endedByDispatch: EndedByDispatch | null
  dismissEndedByDispatch: () => void
  completedTrip: CompletedTrip | null
  noteTripCompleted: (completed: CompletedTrip) => void
  dismissTripCompleted: () => void
}

export interface CompletedTrip {
  tripId: string
  tripReference: string
  phases: readonly PhaseDescriptor[]
}

export interface EndedByDispatch {
  tripId: string
  tripReference: string
  endedAt: string | null
}

const ENDED_BY_DISPATCH_STATUS: Trip['status'] = 'cancelled'

function endedRecord(trip: Trip): EndedByDispatch {
  return { tripId: String(trip.id), tripReference: trip.trip_reference, endedAt: trip.closed_at }
}

export const TripContext = createContext<TripState | null>(null)

export function TripProvider({ children }: { children: React.ReactNode }) {
  const authCtx = useContext(AuthContext)
  return <AccountTripProvider key={`${authCtx?.user?.id ?? ''}:${actorGeneration()}`}>{children}</AccountTripProvider>
}

function AccountTripProvider({ children }: { children: React.ReactNode }) {
  const authCtx = useContext(AuthContext)
  const isCurrentAccount = useAccountGuard(authCtx?.user ? String(authCtx.user.id) : null)

  const mockTrip = useMemo(() => {
    if (!authCtx?.user) return null
    return (
      mockTrips.find(
        t => t.driver?.id === authCtx.user!.id && !['closed', 'cancelled'].includes(t.status),
      ) ?? null
    )
  }, [authCtx])

  const [serverTrip, setServerTrip] = useState<Trip | null>(null)
  const custodySequence = serverTrip?.driver_access?.custody_sequence ?? serverTrip?.custody_sequence ?? null
  const [syncingPhases, setSyncingPhases] = useState<readonly { id: string; custodySequence: number | null }[]>([])
  const syncingPhaseIds = useMemo(() => syncingPhases
    .filter(item => item.custodySequence === custodySequence).map(item => item.id), [syncingPhases, custodySequence])
  const trip = useMemo(
    () => withOptimisticResolution(serverTrip, syncingPhaseIds),
    [serverTrip, syncingPhaseIds],
  )
  const [isLoading, setIsLoading] = useState(!IS_DEMO_MODE)
  const [selectedTripId, setSelectedTripId] = useState<string | null>(() => readSelectedTripId())
  const [handedOverTripId, setHandedOverTripId] = useState<string | null>(null)
  const [endedByDispatch, setEndedByDispatch] = useState<EndedByDispatch | null>(null)
  const [completedTrip, setCompletedTrip] = useState<CompletedTrip | null>(null)
  const workingTripIdRef = useRef<string | null>(null)

  setCustodyContext({
    actorId: authCtx?.user ? String(authCtx.user.id) : null,
    tripId: serverTrip !== null ? String(serverTrip.id) : null,
    custodySequence: serverTrip?.driver_access?.custody_sequence ?? serverTrip?.custody_sequence ?? null,
  })

  const persistSelection = useCallback((tripId: string | null) => {
    if (typeof window !== 'undefined') {
      if (tripId === null) window.sessionStorage.removeItem(SELECTED_TRIP_KEY)
      else window.sessionStorage.setItem(SELECTED_TRIP_KEY, tripId)
    }
    setSelectedTripId(tripId)
  }, [])

  const noticeEndedWorkingTrip = useCallback(async (active: Trip | null): Promise<void> => {
    const previous = workingTripIdRef.current
    workingTripIdRef.current = active !== null ? String(active.id) : null
    if (previous === null || (active !== null && String(active.id) === previous)) return
    try {
      const former = await fetchMyTrip(previous)
      if (isCurrentAccount() && former.status === ENDED_BY_DISPATCH_STATUS) setEndedByDispatch(endedRecord(former))
    } catch (err) {
      console.warn('Could not check how the previous trip ended', err)
    }
  }, [isCurrentAccount])

  const loadTrip = useCallback(async (): Promise<Trip | null> => {
    if (!isCurrentAccount()) return null
    if (selectedTripId !== null) {
      try {
        const selected = await fetchMyTrip(selectedTripId)
        if (!isCurrentAccount()) return null
        if (!TERMINAL_STATUSES.includes(selected.status)) return selected
        if (selected.status === ENDED_BY_DISPATCH_STATUS) {
          setEndedByDispatch(endedRecord(selected))
          workingTripIdRef.current = null
        }
        persistSelection(null)
      } catch (err) {
        if (!isCurrentAccount()) return null
        if (err instanceof ApiError && err.status === 404) persistSelection(null)
        else if (isTripHandedOver(err)) {
          setHandedOverTripId(selectedTripId)
          persistSelection(null)
        } else throw err
      }
    }
    const active = await fetchMyActiveTrip()
    await noticeEndedWorkingTrip(active)
    return active
  }, [selectedTripId, persistSelection, isCurrentAccount, noticeEndedWorkingTrip])

  const refetchTrip = useCallback(async () => {
    if (!isCurrentAccount()) return null
    if (IS_DEMO_MODE) { setServerTrip(mockTrip); return mockTrip }
    if (!authCtx?.user) { setServerTrip(null); setIsLoading(false); return null }
    setIsLoading(true)
    try {
      const fetched = await loadTrip()
      if (!isCurrentAccount()) return null
      setServerTrip(fetched)
      return fetched
    } finally {
      if (isCurrentAccount()) setIsLoading(false)
    }
  }, [authCtx?.user, mockTrip, loadTrip, isCurrentAccount])

  const selectTrip = useCallback(async (tripId: string): Promise<Trip | null> => {
    if (!isCurrentAccount()) return null
    if (IS_DEMO_MODE) { setServerTrip(mockTrip); return mockTrip }
    persistSelection(tripId)
    setIsLoading(true)
    try {
      const fetched = await fetchMyTrip(tripId)
      if (!isCurrentAccount()) return null
      setServerTrip(fetched)
      return fetched
    } finally {
      if (isCurrentAccount()) setIsLoading(false)
    }
  }, [mockTrip, persistSelection, isCurrentAccount])

  const adoptTrip = useCallback((fresh: Trip) => {
    if (!isCurrentAccount()) return
    setServerTrip(fresh)
    setIsLoading(false)
  }, [isCurrentAccount])

  const markPhaseSyncing = useCallback((phaseEventId: string) => {
    if (!isCurrentAccount()) return
    setSyncingPhases(previous => previous.some(item => item.id === phaseEventId && item.custodySequence === custodySequence)
      ? previous : [...previous, { id: phaseEventId, custodySequence }])
  }, [custodySequence, isCurrentAccount])

  const clearPhaseSyncing = useCallback((phaseEventId: string) => {
    if (!isCurrentAccount()) return
    setSyncingPhases(previous => previous.filter(item => item.id !== phaseEventId || item.custodySequence !== custodySequence))
  }, [custodySequence, isCurrentAccount])

  const clearSelectedTrip = useCallback(async (): Promise<Trip | null> => {
    if (!isCurrentAccount()) return null
    if (IS_DEMO_MODE) { setServerTrip(mockTrip); return mockTrip }
    persistSelection(null)
    setIsLoading(true)
    try {
      const fetched = await fetchMyActiveTrip()
      if (!isCurrentAccount()) return null
      setServerTrip(fetched)
      return fetched
    } finally {
      if (isCurrentAccount()) setIsLoading(false)
    }
  }, [mockTrip, persistSelection, isCurrentAccount])

  const toastCtx = useContext(ToastContext)

  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null)

  const refreshQuietly = useCallback(async (): Promise<void> => {
    if (IS_DEMO_MODE) return
    if (!authCtx?.user || !isCurrentAccount()) return

    setIsRefreshing(true)
    try {
      const fetched = await loadTrip()
      if (!isCurrentAccount()) return
      setServerTrip(fetched)
      setLastRefreshedAt(new Date().toISOString())
    } catch (err) {
      if (!isCurrentAccount()) return
      console.error('Quiet trip refresh failed', err)
    } finally {
      if (isCurrentAccount()) setIsRefreshing(false)
    }
  }, [authCtx?.user, loadTrip, isCurrentAccount])

  const noteTripHandedOver = useCallback((tripId: string) => {
    if (!isCurrentAccount()) return
    setHandedOverTripId(tripId)
    if (selectedTripId === tripId) {
      persistSelection(null)
      setServerTrip(null)
    } else if (serverTrip !== null && String(serverTrip.id) === tripId) {
      setServerTrip(null)
      void refreshQuietly()
    }
  }, [selectedTripId, serverTrip, persistSelection, refreshQuietly, isCurrentAccount])

  const dismissHandedOver = useCallback(() => setHandedOverTripId(null), [])
  const dismissEndedByDispatch = useCallback(() => setEndedByDispatch(null), [])

  const noteTripCompleted = useCallback((completed: CompletedTrip) => {
    if (!isCurrentAccount()) return
    setCompletedTrip(completed)
  }, [isCurrentAccount])

  const dismissTripCompleted = useCallback(() => {
    setCompletedTrip(null)
    void refreshQuietly()
  }, [refreshQuietly])

  useEffect(() => {
    if (serverTrip !== null) workingTripIdRef.current = String(serverTrip.id)
  }, [serverTrip])

  const actionable = trip !== null ? actionablePhase(trip.phases) : null

  const hasNoTrip = trip === null && !isLoading && !IS_DEMO_MODE
  const pollingEnabled =
    hasNoTrip ||
    (trip !== null && ((actionable?.blocked_on ?? null) !== null || trip.status === 'exception_hold'))

  useTripAutoRefresh({
    pollingEnabled,
    intervalMs: hasNoTrip ? UNASSIGNED_TRIP_POLL_INTERVAL_MS : TRIP_POLL_INTERVAL_MS,
    onRefresh: refreshQuietly,
  })

  const actionablePhaseEventId = actionable !== null ? String(actionable.phase_event_id) : null
  const actionableBlockedOn = actionable?.blocked_on ?? null
  const previousGateRef = useRef<{ phaseEventId: string | null; blockedOn: string | null } | null>(null)

  useEffect(() => {
    const previous = previousGateRef.current
    previousGateRef.current = { phaseEventId: actionablePhaseEventId, blockedOn: actionableBlockedOn }

    if (previous === null) return
    if (previous.phaseEventId !== actionablePhaseEventId) return
    if (previous.blockedOn === null || actionableBlockedOn !== null) return

    toastCtx?.notify({
      kind: 'info',
      title: 'You can continue',
      body: 'The warehouse has finished. This step is ready.',
    })
  }, [actionablePhaseEventId, actionableBlockedOn, toastCtx])

  useEffect(() => {
    if (IS_DEMO_MODE) {
      Promise.resolve().then(() => { if (isCurrentAccount()) setServerTrip(mockTrip) })
      return
    }
    if (!authCtx?.user) {
      Promise.resolve().then(() => { if (isCurrentAccount()) { setServerTrip(null); setIsLoading(false) } })
      return
    }

    Promise.resolve().then(() => { if (isCurrentAccount()) setIsLoading(true) })
    loadTrip()
      .then(fetched => { if (isCurrentAccount()) setServerTrip(fetched) })
      .catch((err: unknown) => {
        if (!isCurrentAccount()) return
        console.error('Failed to load the driver\'s current trip', err)
        setServerTrip(null)
      })
      .finally(() => { if (isCurrentAccount()) setIsLoading(false) })
  }, [authCtx?.user, mockTrip, loadTrip, isCurrentAccount])

  const [exceptions, setExceptions] = useState<TripException[]>([])
  const [syncedTripId, setSyncedTripId] = useState<string | null>(null)

  if (trip !== null && (trip.id as string) !== syncedTripId) {
    setSyncedTripId(trip.id as string)
    setExceptions(trip.exceptions)
  }

  const logException = useCallback(async (type: ExceptionType, payload: Record<string, unknown>) => {
    if (!trip) return
    const description = typeof payload.description === 'string' ? payload.description : ''
    const photoIds = Array.isArray(payload.supporting_artifact_ids)
      ? payload.supporting_artifact_ids.filter((id): id is string => typeof id === 'string')
      : []
    const supportingArtifactId = photoIds[0]
    const clientReportId = typeof payload.clientReportId === 'string'
      ? payload.clientReportId
      : crypto.randomUUID()
    const gpsLat = typeof payload.gpsLat === 'number' ? payload.gpsLat : undefined
    const gpsLng = typeof payload.gpsLng === 'number' ? payload.gpsLng : undefined
    const hasGpsFix = gpsLat !== undefined && gpsLng !== undefined
    const driverCapturedAt = typeof payload.driverCapturedAt === 'string'
      ? payload.driverCapturedAt
      : undefined
    const driverAccuracyMetres = typeof payload.driverAccuracyMetres === 'number'
      ? payload.driverAccuracyMetres
      : undefined
    const rawVehicleType = payload.vehicleType
    const vehicleType: VehicleType | undefined =
      rawVehicleType === 'horse' || rawVehicleType === 'trailer' ? rawVehicleType : undefined
    const trailerId = typeof payload.trailerId === 'string' ? payload.trailerId : undefined

    const phaseEventId = contextPhaseEventId(trip.phases)

    if (IS_DEMO_MODE) {
      const criticalTypes: ExceptionType[] = [
        'panic_button', 'seal_broken_in_transit', 'seal_mismatch', 'seal_compromised',
      ]
      const newExc: TripException = {
        id: crypto.randomUUID() as unknown as TripException['id'],
        trip_id: trip.id, exception_type: type, source: 'driver',
        severity: criticalTypes.includes(type) ? 'critical' : 'warning',
        description,
        phase_event_id: phaseEventId, checkpoint_id: null, supporting_artifact_id: null,
        gps_lat: hasGpsFix ? gpsLat : null,
        gps_lng: hasGpsFix ? gpsLng : null,
        vehicle_id: demoBreakdownVehicleId(trip, type, vehicleType, trailerId),
        review_status: 'needs_review',
        review_outcome: null, reviewed_by_user_id: null,
        reviewed_at: null, review_note: null, contact_method: null,
        merkle_batch_id: null,
        claimed_by_user_id: null, claimed_at: null, claimed_by_name: null, reviewed_by_name: null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }
      setExceptions(prev => [...prev, newExc])
      return
    }

    const custodyAtCapture = typeof payload.custodySequence === 'number'
      ? payload.custodySequence
      : captureCustody(String(trip.id)).custodySequence
    const created = await raiseException(String(trip.id), {
      exception_type: type, description, supporting_artifact_id: supportingArtifactId,
      ...(custodyAtCapture !== null ? { custody_sequence: custodyAtCapture } : {}),
      ...(photoIds.length > 0 ? { supporting_artifact_ids: photoIds } : {}),
      client_report_id: clientReportId,
      ...(phaseEventId ? { phase_event_id: String(phaseEventId) } : {}),
      ...(vehicleType ? { vehicle_type: vehicleType } : {}),
      ...(trailerId ? { trailer_id: trailerId } : {}),
      gps_lat: hasGpsFix ? gpsLat : undefined,
      gps_lng: hasGpsFix ? gpsLng : undefined,
      driver_captured_at: driverCapturedAt,
      driver_accuracy_metres: driverAccuracyMetres,
    })
    setExceptions(prev => [...prev, created])
  }, [trip])

  return (
    <TripContext.Provider
      value={{
        trip, isLoading, exceptions,
        logException, refetchTrip,
        selectTrip, clearSelectedTrip, adoptTrip,
        syncingPhaseIds, markPhaseSyncing, clearPhaseSyncing,
        refreshQuietly, isRefreshing, lastRefreshedAt,
        handedOverTripId, noteTripHandedOver, dismissHandedOver,
        endedByDispatch, dismissEndedByDispatch,
        completedTrip, noteTripCompleted, dismissTripCompleted,
      }}
    >
      {children}
    </TripContext.Provider>
  )
}
