"use client"

import { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import type { Trip } from '@shared/lib/types/trip'
import type { HandshakeNumber } from '@shared/lib/types/handshake'
import type { TripException, ExceptionType } from '@shared/lib/types/exception'
import { mockTrips } from '@shared/lib/mocks/trips'
import { HANDSHAKE_STEP_COUNTS, STEP_SLUGS } from '@shared/lib/constants/handshake-meta'
import { ROUTES } from '@/lib/constants/routes'
import { IS_DEMO_MODE } from '@/lib/constants/env'
import { fetchMyActiveTrip } from '@/lib/api/trips'
import { raiseException } from '@/lib/api/exceptions'
import { AuthContext } from './AuthContext'

export interface TripState {
  trip: Trip | null
  isLoading: boolean
  currentHandshake: HandshakeNumber
  currentStep: number
  totalSteps: number
  exceptions: TripException[]
  advance: () => void
  goBack: () => void
  logException: (type: ExceptionType, payload: Record<string, unknown>) => Promise<void>
  triggerPanic: () => void
  reset: () => void
  refetchTrip: () => Promise<Trip | null>
}

export const TripContext = createContext<TripState | null>(null)

// Trip.status records the handshake that was just COMPLETED, not one in progress —
// confirmed in backend/app/orchestration/handshake_service.py: advance_h1 sets
// status='origin_gate_in' when H1 finishes, advance_h2 sets 'loading' when H2
// finishes, advance_h3 sets 'in_transit' directly when H3 finishes (the backend
// never actually persists 'origin_gate_out' as a Trip.status value — it jumps
// straight from 'loading' to 'in_transit'), advance_h4 sets 'dest_gate_in' (or
// 'exception_hold' on a seal mismatch) when H4 finishes, advance_h5 sets 'closed'
// when H5 finishes. So this must map each status to the NEXT actionable handshake
// — one past the one already done. Mapping a status to "that handshake number" (as
// this used to) replays an already-completed handshake every time the app reloads,
// freezing driver progress. Exported (named) for unit testing.
export function handshakeFromStatus(status: Trip['status']): HandshakeNumber {
  switch (status) {
    case 'created':          return 1
    case 'origin_gate_in':   return 2
    case 'loading':          return 3
    // Defensive: the backend currently never persists this status (H3 completion
    // jumps straight to 'in_transit'), but map it correctly in case that changes.
    case 'origin_gate_out':  return 4
    // in_transit means H3 is done; H4 is reached via the same manual
    // hold-to-confirm advance() flow as every other handshake.
    case 'in_transit':       return 4
    case 'dest_gate_in':     return 5
    // Defensive: the backend currently never persists this status (H5 completion
    // jumps straight to 'closed'), but map it correctly in case that changes.
    case 'unloading':        return 5
    default:                 return 1
  }
}

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

  // refetchTrip is exposed for manual re-fetching after a handshake submission. It's
  // deliberately not called directly inside the useEffect below — calling a setState-
  // containing callback synchronously from an effect causes cascading renders (same
  // anti-pattern AuthContext.tsx avoids); the effect inlines its own fetch instead.
  const refetchTrip = useCallback(async () => {
    if (IS_DEMO_MODE) { setTrip(mockTrip); return mockTrip }
    if (!authCtx?.user) { setTrip(null); setIsLoading(false); return null }
    setIsLoading(true)
    try {
      const fetched = await fetchMyActiveTrip()
      setTrip(fetched)
      return fetched
    } finally {
      setIsLoading(false)
    }
  }, [authCtx?.user, mockTrip])

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
    fetchMyActiveTrip()
      .then(setTrip)
      .finally(() => setIsLoading(false))
  }, [authCtx?.user, mockTrip])

  const [currentHandshake, setCurrentHandshake] = useState<HandshakeNumber>(1)
  const [currentStep, setCurrentStep] = useState(1)
  const [exceptions, setExceptions] = useState<TripException[]>([])
  // Track which trip's initial state we've applied — avoids the useEffect + setState anti-pattern.
  // When a new trip loads, reset derived state synchronously during render (React docs recommended).
  const [syncedTripId, setSyncedTripId] = useState<string | null>(null)

  if (trip !== null && (trip.id as string) !== syncedTripId) {
    setSyncedTripId(trip.id as string)
    setCurrentHandshake(handshakeFromStatus(trip.status))
    setCurrentStep(1)
    setExceptions(trip.exceptions)
  }

  const totalSteps = HANDSHAKE_STEP_COUNTS[currentHandshake]

  const advance = useCallback(() => {
    if (!trip) return
    const h = currentHandshake as 1 | 2 | 3 | 4 | 5

    if (currentStep < totalSteps) {
      const next = currentStep + 1
      setCurrentStep(next)
      router.push(ROUTES.handshakeStep(h, STEP_SLUGS[h][next - 1]))
      return
    }

    // Last step of H3 → in-transit hub (driver departs origin)
    if (currentHandshake === 3) {
      router.push(ROUTES.inTransit)
      return
    }

    // Last step of any other handshake → first step of next handshake
    if (currentHandshake < 5) {
      const nextH = (currentHandshake + 1) as 1 | 2 | 3 | 4 | 5
      setCurrentHandshake(nextH)
      setCurrentStep(1)
      router.push(ROUTES.handshakeStep(nextH, STEP_SLUGS[nextH][0]))
    }
    // H5 step 6 (closed) handles its own navigation back to home
  }, [trip, currentHandshake, currentStep, totalSteps, router])

  const goBack = useCallback(() => {
    if (!trip) return
    const h = currentHandshake as 1 | 2 | 3 | 4 | 5

    if (currentStep > 1) {
      const prev = currentStep - 1
      setCurrentStep(prev)
      router.push(ROUTES.handshakeStep(h, STEP_SLUGS[h][prev - 1]))
      return
    }

    // H4 step 1 goBack → in-transit hub (driver hasn't departed yet)
    if (currentHandshake === 4) {
      router.push(ROUTES.inTransit)
      return
    }

    if (currentHandshake > 1) {
      const prevH = (currentHandshake - 1) as 1 | 2 | 3 | 4 | 5
      const prevTotal = HANDSHAKE_STEP_COUNTS[prevH]
      setCurrentHandshake(prevH)
      setCurrentStep(prevTotal)
      router.push(ROUTES.handshakeStep(prevH, STEP_SLUGS[prevH][prevTotal - 1]))
    }
  }, [trip, currentHandshake, currentStep, router])

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
        handshake_event_id: null, checkpoint_id: null, supporting_artifact_id: null,
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
    setCurrentHandshake(handshakeFromStatus(trip.status))
    setCurrentStep(1)
    setExceptions(trip.exceptions)
  }, [trip])

  return (
    <TripContext.Provider
      value={{
        trip, isLoading, currentHandshake, currentStep, totalSteps, exceptions,
        advance, goBack, logException, triggerPanic, reset, refetchTrip,
      }}
    >
      {children}
    </TripContext.Provider>
  )
}
