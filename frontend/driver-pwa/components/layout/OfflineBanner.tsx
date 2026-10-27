'use client'

import { useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { WifiOff, Loader2, X } from 'lucide-react'
import { ROUTES } from '@/lib/constants/routes'
import { useOfflineQueue } from '@/lib/hooks/useOfflineQueue'
import { dismissPhaseSubmissionFailure, usePhaseSubmissions } from '@/lib/submission/phase-submitter'
import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'
import { cn } from '@/lib/utils'

const ROW_CLASS = 'flex items-center gap-2 px-4 py-2 text-footnote font-semibold'
const PROGRESS_ROW = 'bg-fill text-surface-on-variant'
const ATTENTION_ROW = 'bg-attention-tint text-attention-ink'
const ERROR_ROW = 'bg-error-tint text-error'
const DISMISS_CLASS = '-my-2.5 flex size-11 shrink-0 items-center justify-center rounded-full active:bg-surface-on/10'

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
  const { queueLength, attentionCount, retryAttention } = useOfflineQueue()
  const { inFlight, failures } = usePhaseSubmissions()

  const hasBackgroundWork = inFlight.length > 0 || failures.length > 0

  if (online && queueLength === 0 && attentionCount === 0 && !hasBackgroundWork) return null

  return (
    <div className="flex flex-col">
      {!online && (
        <div role="status" className={cn(ROW_CLASS, ATTENTION_ROW)}>
          <WifiOff className="size-4 shrink-0" aria-hidden />
          You&rsquo;re offline. Evidence you capture is saved on this device.
        </div>
      )}

      {inFlight.length > 0 && (
        <div role="status" className={cn(ROW_CLASS, PROGRESS_ROW)}>
          <Loader2 className="size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
          {inFlight.length === 1
            ? 'Recording evidence…'
            : `Recording evidence for ${inFlight.length} phases…`}
        </div>
      )}

      {queueLength > 0 && (
        <div role="status" className={cn(ROW_CLASS, PROGRESS_ROW)}>
          <Loader2 className="size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
          {queueLength} {queueLength === 1 ? 'item' : 'items'} waiting to sync
        </div>
      )}

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
