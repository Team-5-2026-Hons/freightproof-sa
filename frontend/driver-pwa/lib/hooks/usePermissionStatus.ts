'use client'

import { useEffect, useState } from 'react'
import { Camera } from '@capacitor/camera'
import { Geolocation } from '@capacitor/geolocation'

export type PermissionKind = 'location' | 'camera'

/** What the Profile row shows. 'ask' = the phone will ask the next time it is needed. */
export type PermissionStatus = 'granted' | 'denied' | 'ask'

async function read(kind: PermissionKind): Promise<PermissionStatus> {
  // The Capacitor plugins answer on both native and web (where they wrap
  // navigator.permissions), so one call path covers the APK, the iOS app and the PWA.
  const state = kind === 'location'
    ? (await Geolocation.checkPermissions()).location
    : (await Camera.checkPermissions()).camera
  if (state === 'granted') return 'granted'
  if (state === 'denied') return 'denied'
  return 'ask'
}

/**
 * Live status of a phone permission the trip depends on, for the Profile screen. Null
 * while unknown or when the platform cannot say (iOS Safari has no Permissions API for
 * the camera) — the row is then hidden rather than showing a guess.
 */
export function usePermissionStatus(kind: PermissionKind): PermissionStatus | null {
  const [status, setStatus] = useState<PermissionStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    const refresh = () => {
      read(kind)
        .then((next) => { if (!cancelled) setStatus(next) })
        .catch((err: unknown) => {
          // Expected on platforms without the API; logged so a real failure is traceable.
          console.info(`usePermissionStatus(${kind}): status unavailable`, err)
          if (!cancelled) setStatus(null)
        })
    }
    refresh()
    // The fix for "denied" is the phone's Settings app; re-read when the driver returns.
    const onVisible = () => { if (document.visibilityState !== 'hidden') refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [kind])

  return status
}
