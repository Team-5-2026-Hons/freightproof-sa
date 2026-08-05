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

// The route itself never carries a trip id (see lib/constants/routes.ts's header note,
// which lib/phase/routes.ts's phaseStepRoute inherits) — the backend enforces one active
// trip per driver, so "which trip" always comes from TripContext, never from the push
// payload or the URL.
// Where a gate-arrival push lands. in_transit no longer has ANY driver step — its old
// '1-arrival' step existed only to ask for a GPS fix, and the phase is auto-completed
// server-side — so an empty recipe is now a normal, expected state here rather than an
// impossible one. Without this guard the route composed as ".../step/undefined", a URL
// that renders nothing: a destination-arrival push would strand the driver on a blank
// screen. Falling back to the active trip shows them whatever phase IS actionable.
function gateArrivalRoute(phaseType: GateArrivalPhaseType): string {
  const slug = STEP_SLUGS[phaseType][0]
  return slug === undefined ? ROUTES.activeTripDetail : phaseStepRoute(phaseType, slug)
}

export function usePushNotifications(): PushNotificationsState {
  const router = useRouter()

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    PushNotifications.requestPermissions().then(result => {
      if (result.receive === 'granted') PushNotifications.register()
    })

    const listenerPromise = PushNotifications.addListener('pushNotificationReceived', notification => {
      if (notification.data?.type !== 'GATE_ARRIVAL') return
      const phaseType = notification.data.phase_type as GateArrivalPhaseType
      router.push(gateArrivalRoute(phaseType))
    })

    return () => {
      listenerPromise.then(l => l.remove())
    }
  }, [router])

  const simulateGateArrival = useCallback((phaseType: GateArrivalPhaseType) => {
    router.push(gateArrivalRoute(phaseType))
  }, [router])

  return { simulateGateArrival }
}
