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

// Distinguishes *why* a capture failed so the UI can give the driver actionable
// remediation instead of a single generic "Retry GPS" — retrying is useless for
// permission_denied (the driver must leave the app to fix it) but is exactly the
// right move for timeout/position_unavailable (move to open sky, try again).
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

// Dev-only convenience fallback — Linbro Park, JHB (FedEx origin depot). This exists
// solely so a developer on a laptop browser (no GPS hardware, or geolocation blocked
// by a corp policy) can exercise the handshake flow without a real device. It must
// NEVER stand in for a real reading in production: FreightProof is an evidence
// platform, and a fabricated coordinate that looks like a genuine capture is the
// single worst defect this app can ship. The NODE_ENV === 'development' gate at the
// call site is load-bearing for that guarantee — Next.js inlines NODE_ENV at build
// time, so a production bundle can never take this branch, even if geolocation is
// unavailable or every attempt fails.
const LINBRO_PARK: LocationCoords = {
  latitude: -26.0942, longitude: 28.1342, accuracy: 5, capturedAt: '',
}

// W3C GeolocationPositionError codes (https://w3c.github.io/geolocation/#position-error).
// Named instead of inlined per the project's no-magic-numbers rule, and reused below
// to defensively pattern-match native (Capacitor) rejections that don't carry them.
const GEOLOCATION_PERMISSION_DENIED = 1
const GEOLOCATION_POSITION_UNAVAILABLE = 2
const GEOLOCATION_TIMEOUT = 3

function sampleTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || Number.isNaN(new Date(timestamp).getTime())) {
    throw new Error('Invalid device location timestamp')
  }
  return new Date(timestamp).toISOString()
}

// Browser rejections are a real GeolocationPositionError with a numeric `code`. Native
// (Capacitor Android) rejections are plain Errors carrying only a message — the plugin's
// Android implementation (Geolocation.java) calls call.reject(message) with strings like
// "Location permission was denied", "location disabled", "location unavailable" and never
// attaches a code — so the message match below is what actually classifies the native
// path. An unrecognised shape must never throw here; it just loses the specific
// remediation copy and falls back to 'unknown'.
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

// Wraps the callback-based browser Geolocation API in a Promise, mirroring the native
// branch's semantics (high accuracy, 10s timeout) so both paths behave identically from
// the caller's perspective and produce the same LocationCoords shape.
function getBrowserPosition(): Promise<LocationCoords> {
  return new Promise<LocationCoords>((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Geolocation is not available in this browser'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // Browser callbacks run after the Promise executor; malformed samples must
        // reject the capture rather than throw globally and leave it pending forever.
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
          // Real devices always take the native branch above, so the only place a
          // laptop browser with no/blocked GPS needs to keep working is local dev.
          // Gated to development so this can never substitute for a real reading in
          // a shipped build — see the LINBRO_PARK comment above.
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
      // Classify the failure so GpsCapture can show remediation instead of a bare
      // "Retry GPS" — e.g. retrying is pointless when permission is denied.
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
