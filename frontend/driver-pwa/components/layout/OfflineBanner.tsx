'use client'

import { useSyncExternalStore } from 'react'
import { WifiOff, Loader2, X } from 'lucide-react'
import { useOfflineQueue } from '@/lib/hooks/useOfflineQueue'

// navigator.onLine via useSyncExternalStore: SSR-safe (server snapshot = online)
// and updates on the browser's online/offline events without manual listeners in effects.
function subscribe(cb: () => void): () => void {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}

export function OfflineBanner() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true)
  // AppShell mounts this once per screen, and whichever trip-flow page is open mounts
  // its own useOfflineQueue() instance to get enqueue*/flush — this is deliberately a
  // SECOND concurrently-mounted instance. That's why the flush mutex and queue state
  // live at module scope inside the hook (see useOfflineQueue.ts): without that, this
  // instance's mount-time flush could race the page instance's and double-submit
  // evidence. Both instances read the same shared state, so queueLength/droppedCount
  // here always match what the page instance sees.
  const { queueLength, droppedCount, dismissDropped } = useOfflineQueue()

  // Nothing to show at all — hide the wrapper entirely so it doesn't reserve space.
  if (online && queueLength === 0 && droppedCount === 0) return null

  return (
    <div className="flex flex-col">
      {!online && (
        <div role="status" className="flex items-center gap-2 bg-tertiary-container px-4 py-2 text-xs font-medium text-tertiary-on-container">
          <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
          You&rsquo;re offline — evidence you capture is saved on this device.
        </div>
      )}

      {/* Fix 3a: queueLength was already tracked but rendered nowhere, so a driver who
          goes back online had no way to tell whether captured evidence had actually sent
          yet. This shows any time entries are pending — including while online, mid-flush
          — and disappears the moment the queue empties. */}
      {queueLength > 0 && (
        <div role="status" className="flex items-center gap-2 bg-secondary-container px-4 py-1.5 text-xs font-medium text-secondary-on-container">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
          {queueLength} {queueLength === 1 ? 'item' : 'items'} waiting to sync
        </div>
      )}

      {/* Fix 3b: a terminal drop (not a 409 — that means the earlier attempt already
          succeeded) used to be console.warn-only. That's silent data loss from the
          driver's point of view: evidence they captured is gone and nothing tells them.
          Surfaced here as a dismissible line instead; dismissDropped() resets the shared
          count so it clears for every mounted instance, not just this one. */}
      {droppedCount > 0 && (
        <div role="alert" className="flex items-center gap-2 bg-error-container px-4 py-2 text-xs font-medium text-error-on-container">
          <span className="flex-1">
            {droppedCount} {droppedCount === 1 ? 'item' : 'items'} could not be synced and{' '}
            {droppedCount === 1 ? 'was' : 'were'} removed — contact your dispatcher.
          </span>
          <button
            type="button"
            onClick={dismissDropped}
            aria-label="Dismiss sync failure notice"
            className="shrink-0 rounded p-0.5 hover:bg-error-on-container/10"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      )}
    </div>
  )
}
