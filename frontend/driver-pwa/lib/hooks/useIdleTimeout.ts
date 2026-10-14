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
 * Signs the driver out once the handset has been idle past the timeout.
 *
 * Mounted once, inside the auth provider, and only while a driver is signed in. All the
 * decision logic lives in @shared/lib/session/idle so it can be tested without a DOM;
 * this hook is just the wiring — listeners, a timer, and the cross-tab channel.
 *
 * DELIBERATE: only genuine human interaction counts as activity. The app's own
 * background traffic — the location trail, the offline-queue flush, trip auto-refresh —
 * does NOT reset the clock, because a phone in a cradle posting GPS fixes is not a person
 * present at the handset, and counting it would mean the timeout never fired for a
 * running app. The operational consequence is real and intended: a driver who does not
 * touch the phone for the length of the window signs back in (phone OTP) before their
 * next handshake.
 *
 * @param enabled  false while signed out, so the login screen carries no timer
 * @param onExpire called exactly once when the window elapses
 */
export function useIdleTimeout(enabled: boolean, onExpire: () => void): void {
  // Held in a ref so a caller passing an inline arrow doesn't tear down and rebuild every
  // listener on each render.
  const onExpireRef = useRef(onExpire)
  useEffect(() => {
    onExpireRef.current = onExpire
  }, [onExpire])

  useEffect(() => {
    if (!enabled) return

    const store = window.localStorage
    let timer: ReturnType<typeof setTimeout> | undefined
    // Guards against a double fire: the timer and a storage event from another tab can
    // both conclude "expired" within the same tick, and signing out twice would race the
    // auth provider's own teardown.
    let expired = false

    const expire = (): void => {
      if (expired) return
      expired = true
      clearActivity(store)
      onExpireRef.current()
    }

    // Re-arms the timer against the CURRENT stored timestamp rather than a fixed delay.
    // This is what makes the countdown shared across tabs: whichever tab last saw
    // activity wrote the timestamp, and every tab schedules from that same value.
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
      // A visibilitychange firing as the tab is HIDDEN is not a person being present —
      // it is usually the tab being backgrounded. Only the return counts.
      if (document.visibilityState !== 'visible') return
      recordActivity(store)
      rearm()
    }

    // Another tab wrote the timestamp (or cleared it on sign-out). Re-arm from the new
    // value instead of keeping this tab's now-stale countdown.
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== LAST_ACTIVITY_KEY) return
      rearm()
    }

    // Seed on mount. A session restored from a page reload has a timestamp from before
    // the reload, and that is exactly the case this has to catch: an expired session must
    // not be revived by refreshing the page. rearm() checks before it schedules, so an
    // already-expired session signs out here rather than waiting a full window.
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
