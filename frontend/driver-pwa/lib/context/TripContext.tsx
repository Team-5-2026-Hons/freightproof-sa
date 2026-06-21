"use client"

import { createContext, useContext, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import type { Trip } from '@shared/lib/types/trip'
import type { HandshakeNumber } from '@shared/lib/types/handshake'
import type { TripException, ExceptionId, ExceptionType } from '@shared/lib/types/exception'
import { mockTrips } from '@shared/lib/mocks/trips'
import { HANDSHAKE_STEP_COUNTS, STEP_SLUGS } from '@shared/lib/constants/handshake-meta'
import { ROUTES } from '@/lib/constants/routes'
import { AuthContext } from './AuthContext'

export interface TripState {
  trip: Trip | null
  currentHandshake: HandshakeNumber
  currentStep: number
  totalSteps: number
  exceptions: TripException[]
  advance: () => void
  goBack: () => void
  logException: (type: ExceptionType, payload: Record<string, unknown>) => void
  triggerPanic: () => void
  reset: () => void
}

export const TripContext = createContext<TripState | null>(null)

function handshakeFromStatus(status: Trip['status']): HandshakeNumber {
  switch (status) {
    case 'created':          return 1
    case 'origin_gate_in':   return 1
    case 'loading':          return 2
    case 'origin_gate_out':  return 3
    // in_transit means H3 is done; H4 is reached via the same manual
    // hold-to-confirm advance() flow as every other handshake.
    case 'in_transit':       return 4
    case 'dest_gate_in':     return 4
    case 'unloading':        return 5
    default:                 return 1
  }
}

export function TripProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const authCtx = useContext(AuthContext)

  const trip = useMemo(() => {
    if (!authCtx?.user) return null
    return (
      mockTrips.find(
        t => t.driver?.id === authCtx.user!.id && !['closed', 'cancelled'].includes(t.status),
      ) ?? null
    )
  }, [authCtx])

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
      router.push(ROUTES.handshakeStep(String(trip.id), h, STEP_SLUGS[h][next - 1]))
      return
    }

    // Last step of H3 → in-transit hub (driver departs origin)
    if (currentHandshake === 3) {
      router.push(ROUTES.inTransit(String(trip.id)))
      return
    }

    // Last step of any other handshake → first step of next handshake
    if (currentHandshake < 5) {
      const nextH = (currentHandshake + 1) as 1 | 2 | 3 | 4 | 5
      setCurrentHandshake(nextH)
      setCurrentStep(1)
      router.push(ROUTES.handshakeStep(String(trip.id), nextH, STEP_SLUGS[nextH][0]))
    }
    // H5 step 6 (closed) handles its own navigation back to home
  }, [trip, currentHandshake, currentStep, totalSteps, router])

  const goBack = useCallback(() => {
    if (!trip) return
    const h = currentHandshake as 1 | 2 | 3 | 4 | 5

    if (currentStep > 1) {
      const prev = currentStep - 1
      setCurrentStep(prev)
      router.push(ROUTES.handshakeStep(String(trip.id), h, STEP_SLUGS[h][prev - 1]))
      return
    }

    // H4 step 1 goBack → in-transit hub (driver hasn't departed yet)
    if (currentHandshake === 4) {
      router.push(ROUTES.inTransit(String(trip.id)))
      return
    }

    if (currentHandshake > 1) {
      const prevH = (currentHandshake - 1) as 1 | 2 | 3 | 4 | 5
      const prevTotal = HANDSHAKE_STEP_COUNTS[prevH]
      setCurrentHandshake(prevH)
      setCurrentStep(prevTotal)
      router.push(ROUTES.handshakeStep(String(trip.id), prevH, STEP_SLUGS[prevH][prevTotal - 1]))
    }
  }, [trip, currentHandshake, currentStep, router])

  const logException = useCallback((type: ExceptionType, payload: Record<string, unknown>) => {
    const criticalTypes: ExceptionType[] = ['panic_button', 'seal_broken_in_transit', 'seal_mismatch']
    const newExc: TripException = {
      id: crypto.randomUUID() as unknown as ExceptionId,
      trip_id: trip?.id ?? '',
      exception_type: type,
      source: 'driver',
      severity: criticalTypes.includes(type) ? 'critical' : 'warning',
      description: typeof payload.description === 'string' ? payload.description : '',
      handshake_event_id: null, checkpoint_id: null, supporting_artifact_id: null,
      resolved: false, resolved_by_user_id: null, resolved_at: null, resolver_note: null,
      merkle_batch_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    setExceptions(prev => [...prev, newExc])
  }, [trip])

  const triggerPanic = useCallback(() => {
    if (!trip) return
    router.push(ROUTES.panic(String(trip.id)))
  }, [trip, router])

  const reset = useCallback(() => {
    if (!trip) return
    setCurrentHandshake(handshakeFromStatus(trip.status))
    setCurrentStep(1)
    setExceptions(trip.exceptions)
  }, [trip])

  return (
    <TripContext.Provider
      value={{ trip, currentHandshake, currentStep, totalSteps, exceptions, advance, goBack, logException, triggerPanic, reset }}
    >
      {children}
    </TripContext.Provider>
  )
}
