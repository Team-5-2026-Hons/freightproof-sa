// Pure timing/visibility mechanism. Owns the interval, the foreground listeners, the
// single-flight guard, and the offline skip — knows nothing about trips, TripContext, or
// what a "refresh" means.
'use client'

import { useEffect, useRef } from 'react'

export interface TripAutoRefreshOptions {
  pollingEnabled: boolean
  intervalMs: number
  /** Must never throw — the hook does not catch. */
  onRefresh: () => Promise<void>
}

export function useTripAutoRefresh({ pollingEnabled, intervalMs, onRefresh }: TripAutoRefreshOptions): void {
  const inFlightRef = useRef(false)

  const onRefreshRef = useRef(onRefresh)
  useEffect(() => {
    onRefreshRef.current = onRefresh
  }, [onRefresh])

  useEffect(() => {
    async function runRefresh(): Promise<void> {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return
      if (inFlightRef.current) return

      inFlightRef.current = true
      try {
        await onRefreshRef.current()
      } catch (err) {
        console.error('Trip auto-refresh failed', err)
      } finally {
        inFlightRef.current = false
      }
    }

    function handleVisibilityChange(): void {
      if (document.visibilityState !== 'visible') return
      void runRefresh()
    }

    function handleFocus(): void {
      void runRefresh()
    }

    function handleOnline(): void {
      void runRefresh()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleFocus)
    window.addEventListener('online', handleOnline)

    let intervalId: ReturnType<typeof setInterval> | null = null
    if (pollingEnabled) {
      void runRefresh()
      intervalId = setInterval(() => void runRefresh(), intervalMs)
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('online', handleOnline)
      if (intervalId !== null) clearInterval(intervalId)
    }
  }, [pollingEnabled, intervalMs])
}
