'use client'

import { useState, useCallback } from 'react'
import { Capacitor } from '@capacitor/core'
import { Geolocation } from '@capacitor/geolocation'

export interface LocationCoords {
  latitude: number
  longitude: number
  accuracy: number
}

export type LocationStatus = 'idle' | 'capturing' | 'captured' | 'error'

export interface LocationState {
  coords: LocationCoords | null
  status: LocationStatus
  capture: () => Promise<LocationCoords | null>
}

// Fallback for browser dev environment — Linbro Park, JHB (FedEx origin depot)
const LINBRO_PARK: LocationCoords = { latitude: -26.0942, longitude: 28.1342, accuracy: 5 }

export function useLocation(): LocationState {
  const [coords, setCoords] = useState<LocationCoords | null>(null)
  const [status, setStatus] = useState<LocationStatus>('idle')

  const capture = useCallback(async (): Promise<LocationCoords | null> => {
    setStatus('capturing')
    try {
      let result: LocationCoords
      if (Capacitor.isNativePlatform()) {
        const pos = await Geolocation.getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 10_000,
        })
        result = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }
      } else {
        // Simulate GPS acquisition delay for browser dev
        await new Promise<void>((resolve) => setTimeout(resolve, 300))
        result = LINBRO_PARK
      }
      setCoords(result)
      setStatus('captured')
      return result
    } catch (err) {
      // Log the underlying GeolocationPositionError reason (permission denied vs.
      // timeout vs. position unavailable) — these need different driver-facing
      // remediation, so swallowing the reason silently breaks downstream UX.
      console.error('[useLocation] capture failed:', err)
      setStatus('error')
      return null
    }
  }, [])

  return { coords, status, capture }
}
