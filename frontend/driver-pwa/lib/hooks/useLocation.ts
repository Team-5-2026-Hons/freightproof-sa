"use client"

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
  capture: () => Promise<void>
}

// Hardcoded Linbro Park, JHB — returned in non-native (browser) environments.
const LINBRO_PARK: LocationCoords = { latitude: -26.0942, longitude: 28.1342, accuracy: 5 }

export function useLocation(): LocationState {
  const [coords, setCoords] = useState<LocationCoords | null>(null)
  const [status, setStatus] = useState<LocationStatus>('idle')

  const capture = useCallback(async () => {
    setStatus('capturing')
    try {
      if (Capacitor.isNativePlatform()) {
        const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000 })
        setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy })
      } else {
        // Simulate GPS acquisition delay for browser dev
        await new Promise(resolve => setTimeout(resolve, 300))
        setCoords(LINBRO_PARK)
      }
      setStatus('captured')
    } catch {
      setStatus('error')
    }
  }, [])

  return { coords, status, capture }
}
