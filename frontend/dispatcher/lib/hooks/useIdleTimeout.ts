'use client'

import { useEffect, useRef } from 'react'
import {
  ACTIVITY_EVENTS,
  clearActivity,
  isSessionExpired,
  LAST_ACTIVITY_KEY,
  msUntilExpiry,
  readLastActivity,
  recordActivity,
} from '@shared/lib/session/idle'

/**
 * Signs the user out once the machine has been idle past the timeout. Decision logic
 * lives in @shared/lib/session/idle (testable without a DOM); this hook is the wiring.
 *
 * @param enabled  false while signed out, so a login page carries no timer
 * @param onExpire called exactly once when the window elapses
 */
export function useIdleTimeout(enabled: boolean, onExpire: () => void): void {
  const onExpireRef = useRef(onExpire)
  useEffect(() => {
    onExpireRef.current = onExpire
  }, [onExpire])

  useEffect(() => {
    if (!enabled) return

    const store = window.localStorage
    let timer: ReturnType<typeof setTimeout> | undefined
    let expired = false

    const expire = (): void => {
      if (expired) return
      expired = true
      clearActivity(store)
      onExpireRef.current()
    }

    const rearm = (): void => {
      if (expired) return
      if (timer !== undefined) clearTimeout(timer)

      const lastActivity = readLastActivity(store)
      if (isSessionExpired(lastActivity)) {
        expire()
        return
      }
      timer = setTimeout(rearm, msUntilExpiry(lastActivity))
    }

    const onActivity = (): void => {
      if (document.visibilityState !== 'visible') return
      recordActivity(store)
      rearm()
    }

    const onStorage = (event: StorageEvent): void => {
      if (event.key !== LAST_ACTIVITY_KEY) return
      rearm()
    }

    if (readLastActivity(store) === null) recordActivity(store)
    rearm()

    for (const eventName of ACTIVITY_EVENTS) {
      window.addEventListener(eventName, onActivity, { passive: true })
    }
    window.addEventListener('storage', onStorage)

    return () => {
      if (timer !== undefined) clearTimeout(timer)
      for (const eventName of ACTIVITY_EVENTS) {
        window.removeEventListener(eventName, onActivity)
      }
      window.removeEventListener('storage', onStorage)
    }
  }, [enabled])
}
