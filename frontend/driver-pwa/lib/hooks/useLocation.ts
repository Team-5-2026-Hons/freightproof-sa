'use client'

import { useState, useCallback } from 'react'
import { Capacitor } from '@capacitor/core'
import { Geolocation } from '@capacitor/geolocation'

export interface LocationCoords {
  latitude: number
  longitude: number
  accuracy: number
  capturedAt: string
}

export type LocationStatus = 'idle' | 'capturing' | 'captured' | 'error'

export type LocationErrorReason =
  | 'permission_denied'
  | 'timeout'
  | 'position_unavailable'
  | 'unknown'

export interface LocationState {
  coords: LocationCoords | null
  status: LocationStatus
  errorReason: LocationErrorReason | null
  capture: () => Promise<LocationCoords | null>
  captureResult: () => Promise<{ coords: LocationCoords | null; errorReason: LocationErrorReason | null }>
}

const LINBRO_PARK: LocationCoords = {
  latitude: -26.0942, longitude: 28.1342, accuracy: 5, capturedAt: '',
}

const GEOLOCATION_PERMISSION_DENIED = 1
const GEOLOCATION_POSITION_UNAVAILABLE = 2
const GEOLOCATION_TIMEOUT = 3

function sampleTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || Number.isNaN(new Date(timestamp).getTime())) {
    throw new Error('Invalid device location timestamp')
  }
  return new Date(timestamp).toISOString()
}

function mapErrorReason(err: unknown): LocationErrorReason {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: unknown }).code
    if (code === GEOLOCATION_PERMISSION_DENIED) return 'permission_denied'
    if (code === GEOLOCATION_POSITION_UNAVAILABLE) return 'position_unavailable'
    if (code === GEOLOCATION_TIMEOUT) return 'timeout'
  }

  const message = err instanceof Error ? err.message.toLowerCase() : ''
  if (message.includes('denied') || message.includes('disabled') || message.includes('not enabled')) {
    return 'permission_denied'
  }
  if (message.includes('timeout') || message.includes('timed out')) {
    return 'timeout'
  }
  if (message.includes('unavailable')) {
    return 'position_unavailable'
  }
  return 'unknown'
}

function getBrowserPosition(): Promise<LocationCoords> {
  return new Promise<LocationCoords>((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Geolocation is not available in this browser'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        try {
          resolve({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            capturedAt: sampleTime(pos.timestamp),
          })
        } catch (error: unknown) {
          reject(error)
        }
      },
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 10_000 },
    )
  })
}

export function useLocation(): LocationState {
  const [coords, setCoords] = useState<LocationCoords | null>(null)
  const [status, setStatus] = useState<LocationStatus>('idle')
  const [errorReason, setErrorReason] = useState<LocationErrorReason | null>(null)

  const captureResult = useCallback(async (): Promise<{ coords: LocationCoords | null; errorReason: LocationErrorReason | null }> => {
    setStatus('capturing')
    setErrorReason(null)
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
          capturedAt: sampleTime(pos.timestamp),
        }
      } else {
        try {
          result = await getBrowserPosition()
        } catch (browserErr) {
          if (process.env.NODE_ENV === 'development') {
            console.warn('[useLocation] browser geolocation unavailable, using dev fallback:', browserErr)
            result = { ...LINBRO_PARK, capturedAt: new Date().toISOString() }
          } else {
            throw browserErr
          }
        }
      }
      setCoords(result)
      setStatus('captured')
      return { coords: result, errorReason: null }
    } catch (err) {
      const reason = mapErrorReason(err)
      console.error(`[useLocation] capture failed (${reason}):`, err)
      setErrorReason(reason)
      setStatus('error')
      return { coords: null, errorReason: reason }
    }
  }, [])

  const capture = useCallback(async (): Promise<LocationCoords | null> => (await captureResult()).coords, [captureResult])
  return { coords, status, errorReason, capture, captureResult }
}
