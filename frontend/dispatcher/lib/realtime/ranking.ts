// Kept free of React imports so it can be unit-tested apart from RealtimeProvider.

import type { ToastData } from '@/components/ui/Toast'
import type { RealtimeEvent } from './types'

export type ToastRequest = Omit<ToastData, 'id'>

/**
 * The alert an event should raise, or null when it should pass silently.
 *
 * Ranked on `severity`, never `kind` or publisher, so a driver-raised panic exception can't
 * rank quieter than an automated one. Copy names no driver, seal or trip (POPIA); the
 * dispatcher opens the trip for detail.
 */
export function toastForEvent(event: RealtimeEvent): ToastRequest | null {
  // Progress events (create/phase/close) just refetch; they aren't alerts.
  if (event.kind !== 'exception_raised') return null

  if (event.severity === 'info') return null

  const critical = event.severity === 'critical'
  return {
    // Only the alarm tier persists until acknowledged; warnings auto-dismiss.
    kind: critical ? 'error' : 'warning',
    // Read by ToastContext's eviction rule so warnings can't evict a critical alert.
    priority: critical ? 'critical' : 'ordinary',
    title: critical ? 'Critical exception' : 'Exception raised',
    body: critical
      ? 'A critical exception was recorded on a live trip — open it now.'
      : 'An exception was recorded on a live trip — open the trip to review.',
  }
}
