// frontend/driver-pwa/lib/hooks/useTripAutoRefresh.ts
//
// Pure timing/visibility mechanism. Owns the interval, the foreground listeners, the
// single-flight guard, and the offline skip — knows nothing about trips, TripContext, or
// what a "refresh" means. See docs/superpowers/specs/2026-08-10-driver-pwa-trip-auto-refresh-design.md.
'use client'

import { useEffect, useRef } from 'react'

export interface TripAutoRefreshOptions {
  /** Run the periodic poll. The foreground refresh fires regardless of this flag. */
  pollingEnabled: boolean
  intervalMs: number
  /** Must never throw — the hook does not catch. */
  onRefresh: () => Promise<void>
}

export function useTripAutoRefresh({ pollingEnabled, intervalMs, onRefresh }: TripAutoRefreshOptions): void {
  // A ref, not state: two triggers racing in the same tick (e.g. the interval firing the
  // same frame a focus event lands) must observe the same in-flight value synchronously.
  // A state flag would not be readable until the next render, so both could pass the
  // guard and fire a duplicate request.
  const inFlightRef = useRef(false)

  // onRefresh is read through a ref so the listener/interval effect below doesn't need to
  // depend on the callback identity directly. TripContext's refreshQuietly closes over
  // serverTrip and is recreated on most renders; depending on it here would tear the
  // interval down and rebuild it on nearly every tick instead of only when the polling
  // predicate or interval length actually change.
  const onRefreshRef = useRef(onRefresh)
  useEffect(() => {
    onRefreshRef.current = onRefresh
  }, [onRefresh])

  useEffect(() => {
    async function runRefresh(): Promise<void> {
      // Offline-safe: a driver parked at a blocked gate with no signal must not have
      // every tick attempt (and fail) a network request. Checked before the single-flight
      // guard so an offline stretch never leaves inFlightRef stuck true.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return
      if (inFlightRef.current) return

      inFlightRef.current = true
      try {
        await onRefreshRef.current()
      } catch (err) {
        // onRefresh is documented to never throw (TripContext.refreshQuietly catches
        // internally) — this is a last-resort net so a violation of that contract can
        // never become an unhandled rejection or silently kill the poller. Never a
        // toast: see the offline-safe note above, same reasoning applies to any failure.
        console.error('Trip auto-refresh failed', err)
      } finally {
        inFlightRef.current = false
      }
    }

    // Foreground refresh fires unconditionally (not gated on pollingEnabled) — this is
    // the "kill and relaunch" behaviour the driver does by hand today, made automatic.
    // iOS suspends JS timers (the setInterval below) while the Capacitor WKWebView is
    // backgrounded, so this is the only path that reliably catches the trip up the
    // instant the app returns to foreground; the single-flight guard makes the two
    // listeners double-firing on resume harmless.
    function handleVisibilityChange(): void {
      if (document.visibilityState !== 'visible') return
      void runRefresh()
    }

    function handleFocus(): void {
      void runRefresh()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleFocus)

    let intervalId: ReturnType<typeof setInterval> | null = null
    if (pollingEnabled) {
      // Leading edge: ask once NOW, not one interval from now. The gate can close before
      // the driver even walks up to the step, so the plan the screen first renders from is
      // often already stale on arrival — and a trailing-edge-only interval leaves that
      // stale "Waiting for the warehouse" on screen for a full interval, which is
      // indistinguishable from "this page never refreshes" to someone standing at a gate.
      // Safe against loops: this effect is keyed on pollingEnabled, and a refresh that
      // finds the phase still blocked leaves that flag true and the deps unchanged.
      void runRefresh()
      intervalId = setInterval(() => void runRefresh(), intervalMs)
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleFocus)
      if (intervalId !== null) clearInterval(intervalId)
    }
  }, [pollingEnabled, intervalMs])
}
