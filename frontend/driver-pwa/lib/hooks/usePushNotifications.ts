"use client"

import { useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { STEP_SLUGS } from '@shared/lib/constants/handshake-meta'
import { TRIP_0041_ID } from '@shared/lib/mocks/trips'

export interface PushNotificationsState {
  // Simulates a GATE_ARRIVAL push for dev use on the /_dev/tokens page.
  // On a real device this is triggered by FCM via the backend.
  simulateGateArrival: (handshake: 1 | 4) => void
}

export function usePushNotifications(tripId?: string): PushNotificationsState {
  const router = useRouter()
  // Fall back to canonical demo trip when called from outside the trip context (e.g. /_dev/tokens).
  const resolvedTripId = tripId ?? String(TRIP_0041_ID)

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    PushNotifications.requestPermissions().then(result => {
      if (result.receive === 'granted') PushNotifications.register()
    })

    const listenerPromise = PushNotifications.addListener('pushNotificationReceived', notification => {
      if (notification.data?.type !== 'GATE_ARRIVAL') return
      const handshake = notification.data.handshake as 1 | 4
      const slug = STEP_SLUGS[handshake][0]
      router.push(`/trip/${resolvedTripId}/handshake/${handshake}/step/${slug}`)
    })

    return () => {
      listenerPromise.then(l => l.remove())
    }
  }, [router, resolvedTripId])

  const simulateGateArrival = useCallback((handshake: 1 | 4) => {
    const slug = STEP_SLUGS[handshake][0]
    router.push(`/trip/${resolvedTripId}/handshake/${handshake}/step/${slug}`)
  }, [router, resolvedTripId])

  return { simulateGateArrival }
}
