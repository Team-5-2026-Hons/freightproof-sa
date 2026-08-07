'use client'

import { useSyncExternalStore } from 'react'
import { WifiOff, Loader2, X } from 'lucide-react'
import { useOfflineQueue } from '@/lib/hooks/useOfflineQueue'
import { dismissPhaseSubmissionFailure, usePhaseSubmissions } from '@/lib/submission/phase-submitter'
import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'

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
  // Same module-scope-store reasoning, for the in-memory background submitter. AppShell
  // renders this on every screen, which is exactly why it is the right home for both
  // signals: a submission handed off on the step page finishes while the driver is on
  // Home, and a terminal failure has to find them wherever they went.
  const { inFlight, failures } = usePhaseSubmissions()

  const hasBackgroundWork = inFlight.length > 0 || failures.length > 0

  // Nothing to show at all — hide the wrapper entirely so it doesn't reserve space.
  if (online && queueLength === 0 && droppedCount === 0 && !hasBackgroundWork) return null

  return (
    <div className="flex flex-col">
      {!online && (
        <div role="status" className="flex items-center gap-2 bg-tertiary-container px-4 py-2 text-xs font-medium text-tertiary-on-container">
          <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
          You&rsquo;re offline — evidence you capture is saved on this device.
        </div>
      )}

      {/* Workstream 1: the swipe now returns the driver Home immediately while the upload,
          the POST and the Hedera anchor all continue in the background. Without this line
          that work would be completely invisible, and "recorded" would be the only thing
          the driver ever saw — including for evidence still in flight. */}
      {inFlight.length > 0 && (
        <div role="status" className="flex items-center gap-2 bg-secondary-container px-4 py-1.5 text-xs font-medium text-secondary-on-container">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
          {inFlight.length === 1
            ? 'Recording evidence…'
            : `Recording evidence for ${inFlight.length} phases…`}
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

      {/* Workstream 1, terminal-failure notice. A 4xx or a local validation throw can
          never succeed on retry, so it is not queued — and the driver is no longer
          standing on the step screen to see it fail. The error toast fades; this does not.
          Silence here would mean a driver believing evidence was recorded when it was not,
          which is the exact failure this platform exists to prevent. */}
      {failures.map((failure) => (
        <div
          key={failure.phaseEventId}
          role="alert"
          className="flex items-center gap-2 bg-error-container px-4 py-2 text-xs font-medium text-error-on-container"
        >
          <span className="flex-1">
            {PHASE_NAMES[failure.phaseType]} was not recorded: {failure.message} Your
            evidence is still saved on this device, so open the step again and retry.
          </span>
          <button
            type="button"
            onClick={() => dismissPhaseSubmissionFailure(failure.phaseEventId)}
            aria-label={`Dismiss ${PHASE_NAMES[failure.phaseType]} failure notice`}
            className="shrink-0 rounded p-0.5 hover:bg-error-on-container/10"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      ))}

      {/* Fix 3b: a terminal drop (not a 409 — that means the earlier attempt already
          succeeded) used to be console.warn-only. That's silent data loss from the
          driver's point of view: evidence they captured is gone and nothing tells them.
          Surfaced here as a dismissible line instead; dismissDropped() resets the shared
          count so it clears for every mounted instance, not just this one. */}
      {droppedCount > 0 && (
        <div role="alert" className="flex items-center gap-2 bg-error-container px-4 py-2 text-xs font-medium text-error-on-container">
          <span className="flex-1">
            {droppedCount} {droppedCount === 1 ? 'item' : 'items'} could not be synced and{' '}
            {droppedCount === 1 ? 'was' : 'were'} removed. Contact your dispatcher.
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
