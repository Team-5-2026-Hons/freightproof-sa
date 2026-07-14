"use client"

import { useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { STEP_SLUGS } from '@shared/lib/constants/handshake-meta'
import { ROUTES } from '@/lib/constants/routes'

export interface PushNotificationsState {
  // Simulates a GATE_ARRIVAL push for dev use on the /_dev/tokens page.
  // On a real device this is triggered by FCM via the backend.
  simulateGateArrival: (handshake: 1 | 4) => void
}

// The route itself never carries a trip id (see ROUTES.handshakeStep in
// lib/constants/routes.ts) — the backend enforces one active trip per driver, so "which
// trip" always comes from TripContext, never from the push payload or the URL.
export function usePushNotifications(): PushNotificationsState {
  const router = useRouter()

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    PushNotifications.requestPermissions().then(result => {
      if (result.receive === 'granted') PushNotifications.register()
    })

    const listenerPromise = PushNotifications.addListener('pushNotificationReceived', notification => {
      if (notification.data?.type !== 'GATE_ARRIVAL') return
      const handshake = notification.data.handshake as 1 | 4
      const slug = STEP_SLUGS[handshake][0]
      router.push(ROUTES.handshakeStep(handshake, slug))
    })

    return () => {
      listenerPromise.then(l => l.remove())
    }
  }, [router])

  const simulateGateArrival = useCallback((handshake: 1 | 4) => {
    const slug = STEP_SLUGS[handshake][0]
    router.push(ROUTES.handshakeStep(handshake, slug))
  }, [router])

  return { simulateGateArrival }
}
