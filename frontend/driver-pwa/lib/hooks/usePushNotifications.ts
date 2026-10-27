"use client"

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { STEP_SLUGS } from '@shared/lib/constants/phase-meta'
import { phaseStepRoute } from '@/lib/phase'
import { ROUTES } from '@/lib/constants/routes'
import { registerPushToken, type PushPlatform } from '@/lib/api/push'
import type { PhaseType } from '@shared/lib/types/phase'

export type GateArrivalPhaseType = Extract<PhaseType, 'activation' | 'in_transit'>

const GATE_ARRIVAL_TYPE = 'GATE_ARRIVAL'
const GATE_ARRIVAL_PHASES: readonly GateArrivalPhaseType[] = ['activation', 'in_transit']

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

/** The platform the backend stores a token under, or null off a native shell (no push there). */
function pushPlatform(): PushPlatform | null {
  const platform = Capacitor.getPlatform()
  return platform === 'android' || platform === 'ios' ? platform : null
}

export function usePushNotifications(): void {
  const router = useRouter()

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    const openFor = (data: unknown) => {
      const phaseType = gateArrivalPhaseFrom(data)
      if (phaseType !== null) router.push(gateArrivalRoute(phaseType))
    }

    const platform = pushPlatform()

    const listeners = [
      PushNotifications.addListener('registration', ({ value }) => {
        if (platform === null) return
        registerPushToken(value, platform)
          .catch((err: unknown) => console.warn('Could not register the push token with the server', err))
      }),
      PushNotifications.addListener('registrationError', (err) => console.warn('Push registration failed', err)),
      PushNotifications.addListener('pushNotificationReceived', (notification) => openFor(notification.data)),
      PushNotifications.addListener('pushNotificationActionPerformed', (action) => openFor(action.notification.data)),
    ]

    PushNotifications.requestPermissions()
      .then((result) => { if (result.receive === 'granted') return PushNotifications.register() })
      .catch((err: unknown) => console.warn('Push notifications unavailable on this device', err))

    return () => {
      for (const listener of listeners) {
        listener.then((handle) => handle.remove()).catch((err: unknown) => console.warn('Could not remove push listener', err))
      }
    }
  }, [router])
}
