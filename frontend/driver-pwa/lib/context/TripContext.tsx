"use client"

import { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import type { Trip } from '@shared/lib/types/trip'
import type { TripException, ExceptionType } from '@shared/lib/types/exception'
import { mockTrips } from '@shared/lib/mocks/trips'
import { ROUTES } from '@/lib/constants/routes'
import { IS_DEMO_MODE } from '@/lib/constants/env'
import { fetchMyActiveTrip, fetchMyTrip } from '@/lib/api/trips'
import { ApiError } from '@/lib/api/client'
import { raiseException } from '@/lib/api/exceptions'
import { AuthContext } from './AuthContext'

// A trip in one of these states is finished — it can no longer be the trip the driver is
// working, so a pinned selection pointing at one is dropped. Mirrors the backend's
// `inactive` set in trip_service.get_active_trip_for_driver.
const TERMINAL_STATUSES: readonly Trip['status'][] = ['closed', 'cancelled']

// sessionStorage, not localStorage: a selection is a within-session intent ("I am
// starting THIS assignment now"), and it must not outlive the app being closed — a stale
// week-old selection resurfacing ahead of the server's own choice of current trip is
// exactly the confusion this whole change set out to fix.
const SELECTED_TRIP_KEY = 'fp.selectedTripId'

function readSelectedTripId(): string | null {
  // Guarded for SSR/static-export prerender, where window does not exist.
  if (typeof window === 'undefined') return null
  return window.sessionStorage.getItem(SELECTED_TRIP_KEY)
}

export interface TripState {
  trip: Trip | null
  isLoading: boolean
  exceptions: TripException[]
  logException: (type: ExceptionType, payload: Record<string, unknown>) => Promise<void>
  triggerPanic: () => void
  reset: () => void
  refetchTrip: () => Promise<Trip | null>
  // Point the whole phase flow at one specific trip. Needed because the phase step pages
  // resolve which phase_event_id to submit from THIS context (they cannot take the trip
  // from the URL — output: 'export' can't enumerate trip UUIDs as path segments), so a
  // driver activating a chosen Upcoming trip must be able to make it the context trip
  // first. Without this, tapping "Activate" on the second of two assignments would
  // silently submit against whichever trip the server picked as current.
  selectTrip: (tripId: string) => Promise<Trip | null>
  // Adopt a trip the server just returned, without a second round trip to fetch it.
  // POST /phases/{id}/complete already responds with the full updated plan; before this
  // existed, every phase submit followed it with refetchTrip() purely because this
  // context had no way to be told what the caller already held — a whole extra request
  // on the slowest screen in the app, while the driver waited on the swipe.
  adoptTrip: (fresh: Trip) => void
  // Drop the selection and fall back to the server's choice (GET /trips/me/active).
  clearSelectedTrip: () => Promise<Trip | null>
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

  const [trip, setTrip] = useState<Trip | null>(null)
  const [isLoading, setIsLoading] = useState(!IS_DEMO_MODE)
  // Lazily seeded from sessionStorage so a mid-flow reload still addresses the trip the
  // driver chose. Returns null during static prerender (no window), which is harmless:
  // the first paint is the spinner either way.
  const [selectedTripId, setSelectedTripId] = useState<string | null>(() => readSelectedTripId())

  const persistSelection = useCallback((tripId: string | null) => {
    if (typeof window !== 'undefined') {
      if (tripId === null) window.sessionStorage.removeItem(SELECTED_TRIP_KEY)
      else window.sessionStorage.setItem(SELECTED_TRIP_KEY, tripId)
    }
    setSelectedTripId(tripId)
  }, [])

  // Which trip the flow is on: an explicit selection wins, otherwise the server's own
  // pick (GET /trips/me/active). Single resolver so refetchTrip and the mount effect can
  // never disagree about it.
  const loadTrip = useCallback(async (): Promise<Trip | null> => {
    if (selectedTripId !== null) {
      try {
        const selected = await fetchMyTrip(selectedTripId)
        if (!TERMINAL_STATUSES.includes(selected.status)) return selected
        // A finished trip is no longer "the trip I'm on" — drop the pin so the driver
        // isn't stranded on a closed trip, and let the server choose what's next.
        persistSelection(null)
      } catch (err) {
        // 404 means the trip is no longer this driver's (reassigned, or never theirs) —
        // the selection is genuinely dead, so clear it. Any other failure (offline, 5xx)
        // is transient and must NOT silently strip a selection mid-journey.
        if (err instanceof ApiError && err.status === 404) persistSelection(null)
        else throw err
      }
    }
    return fetchMyActiveTrip()
  }, [selectedTripId, persistSelection])

  // refetchTrip is exposed for manual re-fetching after a handshake submission. It's
  // deliberately not called directly inside the useEffect below — calling a setState-
  // containing callback synchronously from an effect causes cascading renders (same
  // anti-pattern AuthContext.tsx avoids); the effect inlines its own fetch instead.
  const refetchTrip = useCallback(async () => {
    if (IS_DEMO_MODE) { setTrip(mockTrip); return mockTrip }
    if (!authCtx?.user) { setTrip(null); setIsLoading(false); return null }
    setIsLoading(true)
    try {
      const fetched = await loadTrip()
      setTrip(fetched)
      return fetched
    } finally {
      setIsLoading(false)
    }
  }, [authCtx?.user, mockTrip, loadTrip])

  // Pin the flow to one specific trip, then load it. Awaited by callers (the trip-detail
  // Activate button) so they only navigate once the phase flow is actually pointed at it.
  const selectTrip = useCallback(async (tripId: string): Promise<Trip | null> => {
    if (IS_DEMO_MODE) { setTrip(mockTrip); return mockTrip }
    persistSelection(tripId)
    setIsLoading(true)
    try {
      const fetched = await fetchMyTrip(tripId)
      setTrip(fetched)
      return fetched
    } finally {
      setIsLoading(false)
    }
  }, [mockTrip, persistSelection])

  // Deliberately not a setter for arbitrary state: it takes a server response only, so
  // the context can never drift into a locally-invented trip. The phase flow's own
  // sequencing guard reads trip.phases from here, and it must only ever reflect what the
  // ledger actually says.
  const adoptTrip = useCallback((fresh: Trip) => {
    setTrip(fresh)
    setIsLoading(false)
  }, [])

  const clearSelectedTrip = useCallback(async (): Promise<Trip | null> => {
    if (IS_DEMO_MODE) { setTrip(mockTrip); return mockTrip }
    persistSelection(null)
    setIsLoading(true)
    try {
      const fetched = await fetchMyActiveTrip()
      setTrip(fetched)
      return fetched
    } finally {
      setIsLoading(false)
    }
  }, [mockTrip, persistSelection])

  useEffect(() => {
    // No synchronous setState here, even for the IS_DEMO_MODE/no-user branches —
    // matches AuthContext.tsx's mount effect, which only ever calls setState from
    // inside a .then() callback to avoid the cascading-render anti-pattern.
    if (IS_DEMO_MODE) {
      Promise.resolve().then(() => setTrip(mockTrip))
      return
    }
    if (!authCtx?.user) {
      Promise.resolve().then(() => { setTrip(null); setIsLoading(false) })
      return
    }

    Promise.resolve().then(() => setIsLoading(true))
    loadTrip()
      .then(setTrip)
      // Previously uncaught: a rejected fetch here (offline, 5xx) became an unhandled
      // rejection and left isLoading stuck true, which reads as a frozen screen. Log and
      // leave trip null so the "no active trip" state renders instead of a dead spinner.
      .catch((err: unknown) => {
        console.error('Failed to load the driver\'s current trip', err)
        setTrip(null)
      })
      .finally(() => setIsLoading(false))
  }, [authCtx?.user, mockTrip, loadTrip])

  const [exceptions, setExceptions] = useState<TripException[]>([])
  // Track which trip's initial state we've applied — avoids the useEffect + setState anti-pattern.
  // When a new trip loads, reset derived state synchronously during render (React docs recommended).
  const [syncedTripId, setSyncedTripId] = useState<string | null>(null)

  if (trip !== null && (trip.id as string) !== syncedTripId) {
    setSyncedTripId(trip.id as string)
    setExceptions(trip.exceptions)
  }

  const logException = useCallback(async (type: ExceptionType, payload: Record<string, unknown>) => {
    if (!trip) return
    const description = typeof payload.description === 'string' ? payload.description : ''
    const supportingArtifactId = typeof payload.supporting_artifact_id === 'string' ? payload.supporting_artifact_id : undefined
    // The panic page captures a GPS fix and promises the driver it will be included —
    // extract it here so it actually reaches the backend instead of being dropped.
    // Both-or-neither: the backend's DriverExceptionCreateBody validator 422s a
    // partial fix, so a lone axis (or a non-number) is treated as no fix at all.
    const gpsLat = typeof payload.gpsLat === 'number' ? payload.gpsLat : undefined
    const gpsLng = typeof payload.gpsLng === 'number' ? payload.gpsLng : undefined
    const hasGpsFix = gpsLat !== undefined && gpsLng !== undefined

    if (IS_DEMO_MODE) {
      const criticalTypes: ExceptionType[] = ['panic_button', 'seal_broken_in_transit', 'seal_mismatch']
      const newExc: TripException = {
        id: crypto.randomUUID() as unknown as TripException['id'],
        trip_id: trip.id, exception_type: type, source: 'driver',
        severity: criticalTypes.includes(type) ? 'critical' : 'warning',
        description,
        phase_event_id: null, checkpoint_id: null, supporting_artifact_id: null,
        // Mirror the real branch so demo mode exercises the same shape the
        // dispatcher UI will eventually read: a coordinate pair or null, never one axis.
        gps_lat: hasGpsFix ? gpsLat : null,
        gps_lng: hasGpsFix ? gpsLng : null,
        resolved: false, resolved_by_user_id: null, resolved_at: null, resolver_note: null,
        merkle_batch_id: null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }
      setExceptions(prev => [...prev, newExc])
      return
    }

    const created = await raiseException(String(trip.id), {
      exception_type: type, description, supporting_artifact_id: supportingArtifactId,
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
      }}
    >
      {children}
    </TripContext.Provider>
  )
}
