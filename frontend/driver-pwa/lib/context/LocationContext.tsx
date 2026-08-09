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
import { useLocation } from '@/lib/hooks/useLocation'
import { useTrip } from '@/lib/hooks/useTrip'
import { useOfflineQueue } from '@/lib/hooks/useOfflineQueue'
import { recordLocations, type LocationPingBody } from '@/lib/api/locations'
import { isQueueableFailure } from '@/lib/utils/is-queueable-failure'
import type { DriverPosition } from '@/lib/types/location'

export interface LocationState {
  /**
   * Take a fix now, for attaching to a submission. Resolves null when the phone can't
   * produce one (permission denied, no signal, inside a warehouse) — callers must treat
   * that as "no position", never as a reason to block evidence from being recorded.
   */
  capturePosition: () => Promise<DriverPosition | null>
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
  const { capture } = useLocation()
  const { enqueueLocation } = useOfflineQueue()

  const tripId = trip !== null ? String(trip.id) : null

  const capturePosition = useCallback(async (): Promise<DriverPosition | null> => {
    const coords = await capture()
    if (coords === null) return null
    return { lat: coords.latitude, lng: coords.longitude, accuracyM: coords.accuracy }
  }, [capture])

  // Read through a ref inside recordHere so the callback identity doesn't change on
  // every trip refetch — the navigation effect below depends on it, and a new identity
  // each render would re-fire the effect and ping on renders rather than on moves.
  const tripIdRef = useRef(tripId)
  useEffect(() => { tripIdRef.current = tripId }, [tripId])

  const recordHere = useCallback((context: string): void => {
    const currentTripId = tripIdRef.current
    // No trip open means nothing to attach a position to, and no reason to hold one.
    if (currentTripId === null || IS_DEMO_MODE) return

    void (async () => {
      const position = await capturePosition()
      // A failed fix is normal (a warehouse roof, a revoked permission) and is simply
      // not recorded. It must never surface as an error: the driver did not ask for
      // this and cannot act on it.
      if (position === null) return

      const ping: LocationPingBody = {
        lat: position.lat,
        lng: position.lng,
        ...(position.accuracyM !== null ? { accuracy_m: position.accuracyM } : {}),
        context,
        recorded_at: new Date().toISOString(),
      }
      try {
        await recordLocations(currentTripId, [ping])
      } catch (err: unknown) {
        // Offline or a 5xx: the queue replays it later with its device timestamp
        // intact. Anything else (a 4xx — closed trip, reassigned driver) is terminal
        // and dropped, because retrying it can only fail the same way forever.
        if (isQueueableFailure(err)) {
          enqueueLocation(currentTripId, [ping])
          return
        }
        console.error('Could not record the driver location ping', err)
      }
    })()
  }, [capturePosition, enqueueLocation])

  // "Whenever the driver does anything" — every screen they open while a trip is live.
  // Navigation is the signal, not a timer: it means the driver acted, so a fix taken
  // here is anchored to something a dispute can reason about ("they opened the seal
  // step here"), and the app never wakes the GPS while the phone sits in a cradle.
  useEffect(() => {
    if (tripId === null) return
    recordHere(pathname)
  }, [pathname, tripId, recordHere])

  const value = useMemo(
    () => ({ capturePosition, recordHere }),
    [capturePosition, recordHere],
  )

  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>
}
