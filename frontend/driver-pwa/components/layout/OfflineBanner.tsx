'use client'

import { useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { WifiOff, Loader2, X } from 'lucide-react'
import { ROUTES } from '@/lib/constants/routes'
import { useOfflineQueue } from '@/lib/hooks/useOfflineQueue'
import { dismissPhaseSubmissionFailure, usePhaseSubmissions } from '@/lib/submission/phase-submitter'
import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'
import { cn } from '@/lib/utils'

// The header strip is the one place a notice must stay compact, so these are the
// StatusBanner tones (components/ui/StatusBanner.tsx) at footnote size rather than
// the raw *-container chip fills the strip used before. Same words, same tints the
// rest of the app uses for "attention" and "error", so a driver reads them the same way.
const ROW_CLASS = 'flex items-center gap-2 px-4 py-2 text-footnote font-semibold'
const PROGRESS_ROW = 'bg-fill text-surface-on-variant'
const ATTENTION_ROW = 'bg-attention-tint text-attention-ink'
const ERROR_ROW = 'bg-error-tint text-error'
// 44px hit area on the dismiss X (the app's documented touch-target minimum; see
// Button/IconButton and Toast's own dismiss), padded outward so the row stays the
// same height.
const DISMISS_CLASS = '-my-2.5 flex size-11 shrink-0 items-center justify-center rounded-full active:bg-surface-on/10'

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
  const router = useRouter()
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true)
  // AppShell mounts this once per screen, and whichever trip-flow page is open mounts
  // its own useOfflineQueue() instance to get enqueue*/flush — this is deliberately a
  // SECOND concurrently-mounted instance. That's why the flush mutex and queue state
  // live at module scope inside the hook (see useOfflineQueue.ts): without that, this
  // instance's mount-time flush could race the page instance's and double-submit
  // evidence. Both instances read the same shared state, so queueLength/droppedCount
  // here always match what the page instance sees.
  const { queueLength, droppedCount, dismissDropped, attentionCount, retryAttention } = useOfflineQueue()
  // Same module-scope-store reasoning, for the in-memory background submitter. AppShell
  // renders this on every screen, which is exactly why it is the right home for both
  // signals: a submission handed off on the step page finishes while the driver is on
  // Home, and a terminal failure has to find them wherever they went.
  const { inFlight, failures } = usePhaseSubmissions()

  const hasBackgroundWork = inFlight.length > 0 || failures.length > 0

  // Nothing to show at all — hide the wrapper entirely so it doesn't reserve space.
  if (online && queueLength === 0 && droppedCount === 0 && attentionCount === 0 && !hasBackgroundWork) return null

  return (
    <div className="flex flex-col">
      {!online && (
        <div role="status" className={cn(ROW_CLASS, ATTENTION_ROW)}>
          <WifiOff className="size-4 shrink-0" aria-hidden />
          You&rsquo;re offline — evidence you capture is saved on this device.
        </div>
      )}

      {/* Workstream 1: the swipe now returns the driver Home immediately while the upload,
          the POST and the Hedera anchor all continue in the background. Without this line
          that work would be completely invisible, and "recorded" would be the only thing
          the driver ever saw — including for evidence still in flight. */}
      {inFlight.length > 0 && (
        <div role="status" className={cn(ROW_CLASS, PROGRESS_ROW)}>
          <Loader2 className="size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
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
        <div role="status" className={cn(ROW_CLASS, PROGRESS_ROW)}>
          <Loader2 className="size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
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
          className={cn(ROW_CLASS, ERROR_ROW)}
        >
          <span className="flex-1">
            {PHASE_NAMES[failure.phaseType]} was not recorded: {failure.message} Your
            evidence is still saved on this device, so open the step again and retry.
          </span>
          <button
            type="button"
            onClick={() => dismissPhaseSubmissionFailure(failure.phaseEventId)}
            aria-label={`Dismiss ${PHASE_NAMES[failure.phaseType]} failure notice`}
            className={DISMISS_CLASS}
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ))}

      {/* Fix 3b: a terminal drop (not a 409 — that means the earlier attempt already
          succeeded) used to be console.warn-only. That's silent data loss from the
          driver's point of view: evidence they captured is gone and nothing tells them.
          Surfaced here as a dismissible line instead; dismissDropped() resets the shared
          count so it clears for every mounted instance, not just this one. */}
      {droppedCount > 0 && (
        <div role="alert" className={cn(ROW_CLASS, ERROR_ROW)}>
          <span className="flex-1">
            {droppedCount} {droppedCount === 1 ? 'item' : 'items'} could not be synced and{' '}
            {droppedCount === 1 ? 'was' : 'were'} removed. Contact your dispatcher.
          </span>
          <button
            type="button"
            onClick={dismissDropped}
            aria-label="Dismiss sync failure notice"
            className={DISMISS_CLASS}
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}

      {/* A capture the server refused, or one kept after a handover (FP-83), is kept and
          never auto-deleted: it is the driver's evidence. Deleting is no longer offered here
          in bulk — the review screen does it one item at a time, with its own warning, and
          offers "Send as late evidence" where custody has moved on. */}
      {attentionCount > 0 && (
        <div role="alert" className={cn('flex flex-col gap-2 px-4 py-2 text-footnote font-semibold', ERROR_ROW)}>
          <span>
            {attentionCount} {attentionCount === 1 ? 'item needs' : 'items need'} attention &mdash; kept on this
            phone. Nothing was deleted.
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => router.push(ROUTES.retainedEvidence)}
              className="min-h-11 rounded-full bg-surface px-4 text-subhead font-semibold text-error active:bg-surface/80"
            >
              Review
            </button>
            <button
              type="button"
              onClick={() => void retryAttention()}
              className="min-h-11 rounded-full bg-surface px-4 text-subhead font-semibold text-error active:bg-surface/80"
            >
              Try again
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
