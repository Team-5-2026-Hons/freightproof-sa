"use client"

import { useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { STEP_SLUGS } from '@shared/lib/constants/phase-meta'
import { phaseStepRoute } from '@/lib/phase'
import { ROUTES } from '@/lib/constants/routes'
import type { PhaseType } from '@shared/lib/types/phase'

// The two "gate arrival" phase types under the phase model — activation (origin gate)
// and in_transit (destination arrival).
// Replaces the old fixed handshake numbers 1 | 4 (origin_gate_in / dest_gate_in): a
// gate-arrival push always lands the driver on that phase's FIRST step, and phase_type
// is the stable, semantic identifier now — not an ordinal that only made sense under
// the old five-handshake enum.
export type GateArrivalPhaseType = Extract<PhaseType, 'activation' | 'in_transit'>

export interface PushNotificationsState {
  // Simulates a GATE_ARRIVAL push for dev use on the /_dev/tokens page.
  // On a real device this is triggered by FCM via the backend.
  simulateGateArrival: (phaseType: GateArrivalPhaseType) => void
}

const GATE_ARRIVAL_TYPE = 'GATE_ARRIVAL'
const GATE_ARRIVAL_PHASES: readonly GateArrivalPhaseType[] = ['activation', 'in_transit']

// The route itself never carries a trip id (see lib/constants/routes.ts's header note,
// which lib/phase/routes.ts's phaseStepRoute inherits) — the backend enforces one active
// trip per driver, so "which trip" always comes from TripContext, never from the push
// payload or the URL.
// Where a gate-arrival push lands. in_transit has no driver STEP — its old '1-arrival'
// step existed only to ask for a GPS fix, and the phase is now submitted from the
// in-transit hub's swipe instead (2026-08-09) — so an empty recipe is a normal, expected
// state here rather than an impossible one. Without this guard the route composed as ".../step/undefined", a URL
// that renders nothing: a destination-arrival push would strand the driver on a blank
// screen. Falling back to the active trip shows them whatever phase IS actionable.
function gateArrivalRoute(phaseType: GateArrivalPhaseType): string {
  const slug = STEP_SLUGS[phaseType][0]
  return slug === undefined ? ROUTES.activeTripDetail : phaseStepRoute(phaseType, slug)
}

/**
 * The phase a push payload points at, or null for anything else. A payload is server
 * data read off the wire: an unknown `phase_type` used to be cast and indexed straight
 * into STEP_SLUGS, which throws inside the listener and leaves the tap doing nothing.
 */
export function gateArrivalPhaseFrom(data: unknown): GateArrivalPhaseType | null {
  if (typeof data !== 'object' || data === null) return null
  const payload = data as Record<string, unknown>
  if (payload.type !== GATE_ARRIVAL_TYPE) return null
  const phase = payload.phase_type
  return GATE_ARRIVAL_PHASES.find((known) => known === phase) ?? null
}

export function usePushNotifications(): PushNotificationsState {
  const router = useRouter()

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    const openFor = (data: unknown) => {
      const phaseType = gateArrivalPhaseFrom(data)
      if (phaseType !== null) router.push(gateArrivalRoute(phaseType))
    }

    PushNotifications.requestPermissions()
      .then((result) => { if (result.receive === 'granted') return PushNotifications.register() })
      // A device without push services rejects here; the app must carry on without push.
      .catch((err: unknown) => console.warn('Push notifications unavailable on this device', err))

    // Two moments, two events: `pushNotificationReceived` fires only while the app is in
    // the foreground; a notification the driver TAPS from the shade (the usual case for a
    // gate arrival) arrives as `pushNotificationActionPerformed` and was never handled, so
    // the tap opened the app on Home and went no further.
    const listeners = [
      PushNotifications.addListener('pushNotificationReceived', (notification) => openFor(notification.data)),
      PushNotifications.addListener('pushNotificationActionPerformed', (action) => openFor(action.notification.data)),
    ]

    return () => {
      for (const listener of listeners) {
        listener.then((handle) => handle.remove()).catch((err: unknown) => console.warn('Could not remove push listener', err))
      }
    }
  }, [router])

  const simulateGateArrival = useCallback((phaseType: GateArrivalPhaseType) => {
    router.push(gateArrivalRoute(phaseType))
  }, [router])

  return { simulateGateArrival }
}
