"use client"

import { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import type { Trip } from '@shared/lib/types/trip'
import type { TripException, ExceptionType } from '@shared/lib/types/exception'
import { mockTrips } from '@shared/lib/mocks/trips'
import { ROUTES } from '@/lib/constants/routes'
import { IS_DEMO_MODE } from '@/lib/constants/env'
import { fetchMyActiveTrip } from '@/lib/api/trips'
import { raiseException } from '@/lib/api/exceptions'
import { AuthContext } from './AuthContext'

export interface TripState {
  trip: Trip | null
  isLoading: boolean
  exceptions: TripException[]
  logException: (type: ExceptionType, payload: Record<string, unknown>) => Promise<void>
  triggerPanic: () => void
  reset: () => void
  refetchTrip: () => Promise<Trip | null>
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
    setExceptions(trip.exceptions)
  }, [trip])

  return (
    <TripContext.Provider
      value={{
        trip, isLoading, exceptions,
        logException, triggerPanic, reset, refetchTrip,
      }}
    >
      {children}
    </TripContext.Provider>
  )
}
