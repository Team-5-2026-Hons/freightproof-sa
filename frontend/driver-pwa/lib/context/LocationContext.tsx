'use client'

// Silent, automatic location capture for the open trip.
//
// Replaces the three "Capture GPS Location" steps the driver used to walk (activation's
// gate arrival, departure's exit approach, in-transit's arrival). Those asked a driver
// standing at a gate, in the rain, to tap a button to tell the app something the phone
// already knew — and captured a position exactly three times per journey. This records
// one every time the driver acts on an open trip, and attaches one to every phase
// submission, without a single tap.
//
// POPIA: this is personal location data. Three constraints hold it in:
//   * It is only ever captured while a trip is open (`trip !== null`). No trip, no
//     tracking — the app does not follow a driver around between jobs.
//   * It is only captured while the app is in the foreground and the driver is using
//     it. There is no background-location permission and no watchPosition subscription
//     here, deliberately: a trail of deliberate actions is what a dispute needs, and it
//     is the least data that answers the question.
//   * It goes to FreightProof's own API only, and is never anchored to Hedera.

import {
  createContext, useCallback, useEffect, useMemo, useRef, type ReactNode,
} from 'react'
import { usePathname } from 'next/navigation'
import { IS_DEMO_MODE } from '@/lib/constants/env'
import { SUBSTITUTION_PATH } from '@/lib/constants/routes'
import { useLocation, type LocationErrorReason } from '@/lib/hooks/useLocation'
import { useTrip } from '@/lib/hooks/useTrip'
import { useOfflineQueue } from '@/lib/hooks/useOfflineQueue'
import { recordLocations, type LocationPingBody } from '@/lib/api/locations'
import { isQueueableFailure } from '@/lib/utils/is-queueable-failure'
import { captureActorLease, captureCustody, isActorLeaseCurrent } from '@/lib/session/custody-context'
import { classifyLiveWriteFailure, isCustodyConflict } from '@/lib/offline/live-write-conflict'
import type { DriverPosition } from '@/lib/types/location'

export interface LocationState {
  /**
   * Take a fix now, for attaching to a submission. Resolves null when the phone can't
   * produce one (permission denied, no signal, inside a warehouse) — callers must treat
   * that as "no position", never as a reason to block evidence from being recorded.
   */
  capturePosition: () => Promise<DriverPosition | null>
  captureObservation: () => Promise<{ position: DriverPosition | null; unavailableReason: LocationErrorReason | null }>
  /**
   * Record where the driver is right now against the open trip. Fire-and-forget: it
   * never throws and never blocks the interaction that triggered it.
   */
  recordHere: (context: string) => void
}

export const LocationContext = createContext<LocationState | null>(null)

export function LocationProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { trip } = useTrip()
  const { captureResult } = useLocation()
  const { enqueueLocation } = useOfflineQueue()

  const tripId = trip !== null ? String(trip.id) : null

  const captureObservation = useCallback(async (): Promise<{ position: DriverPosition | null; unavailableReason: LocationErrorReason | null }> => {
    const result = await captureResult()
    const coords = result.coords
    return {
      position: coords === null ? null : { lat: coords.latitude, lng: coords.longitude, accuracyM: coords.accuracy, capturedAt: coords.capturedAt },
      unavailableReason: result.errorReason,
    }
  }, [captureResult])
  const capturePosition = useCallback(async (): Promise<DriverPosition | null> => (await captureObservation()).position, [captureObservation])

  const tripIdRef = useRef(tripId)
  useEffect(() => { tripIdRef.current = tripId }, [tripId])

  const recordHere = useCallback((context: string): void => {
    const currentTripId = tripIdRef.current
    if (currentTripId === null || IS_DEMO_MODE) return
    const custody = captureCustody(currentTripId)
    const lease = captureActorLease()
    if (lease === null) return

    void (async () => {
      const position = await capturePosition()
      if (position === null) return

      const ping: LocationPingBody = {
        lat: position.lat,
        lng: position.lng,
        ...(position.accuracyM !== null ? { accuracy_m: position.accuracyM } : {}),
        context,
        recorded_at: new Date().toISOString(),
      }
      if (!isActorLeaseCurrent(lease)) {
        enqueueLocation(currentTripId, [ping], custody)
        return
      }
      try {
        await recordLocations(currentTripId, [ping], custody.custodySequence)
      } catch (err: unknown) {
        if (isQueueableFailure(err)) {
          enqueueLocation(currentTripId, [ping], custody)
          return
        }
        const failure = classifyLiveWriteFailure(err)
        if (failure.kind === 'retain' && isCustodyConflict(failure.attention)) {
          enqueueLocation(currentTripId, [ping], custody, failure.attention)
          return
        }
        console.error('Could not record the driver location ping', err)
      }
    })()
  }, [capturePosition, enqueueLocation])

  useEffect(() => {
    if (tripId === null || pathname === SUBSTITUTION_PATH) return
    recordHere(pathname)
  }, [pathname, tripId, recordHere])

  const value = useMemo(
    () => ({ capturePosition, captureObservation, recordHere }),
    [capturePosition, captureObservation, recordHere],
  )

  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>
}
