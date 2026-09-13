// frontend/driver-pwa/components/phase/steps/confirmation/ReceiverHandover.tsx
//
// Replaces PodSignature.tsx (FP-155). The driver no longer collects the signature.
//
// BQ2 (2026-06-29) said proof of delivery is a photo AND a signature, both required. That
// still holds — the artifact is still produced, still uploaded, still required at submit.
// What changed is WHERE it is produced: on the receiver's own phone, reached by scanning
// the rotating QR this step displays. The property that matters is not who the receiver
// is (we still cannot prove that) but that the confirmation was produced somewhere the
// driver's device is not. See docs/iteration2-feedback-response-2026-08-25.md §7.
//
// This step captures nothing locally and holds no evidence of its own. Its entire job is
// to display a code, wait, and write the resulting artifact id into the draft that
// ConfirmationCompleteRequest.pod_signature_artifact_id is built from.
'use client'

import { useEffect } from 'react'
import { StepHeader } from '@/components/phase/StepHeader'
import { SwipeToConfirm } from '@/components/phase/SwipeToConfirm'
import { QrCode } from '@/components/ui/QrCode'
import { Button } from '@/components/ui/Button'
import { useRotatingHandover } from '@/lib/hooks/useRotatingHandover'
import { formatTime } from '@/lib/utils/format-time'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { ConfirmationEvidence } from '@/lib/types/evidence-draft'

interface ReceiverHandoverProps {
  tripId: string
  phase: PhaseDescriptor
  stepIndex: number
  draft: ConfirmationEvidence
  onUpdate: (patch: Partial<ConfirmationEvidence>) => void
  onComplete: () => void | Promise<void>
}

export function ReceiverHandover({
  tripId, phase, stepIndex, draft, onUpdate, onComplete,
}: ReceiverHandoverProps) {
  const {
    scanUrl, receiverOpened, signatureArtifactId, confirmedAt, error, isIssuing, forceNewCode,
  } = useRotatingHandover(tripId, phase.phase_event_id)

  // The draft, not component state, is what survives the driver backgrounding the app
  // mid-handover — usePhaseDraft persists it. Written in an effect rather than during
  // render because it is a side effect on a parent-owned store.
  useEffect(() => {
    if (signatureArtifactId === null) return
    if (draft.podSignatureArtifactId === signatureArtifactId) return
    onUpdate({ podSignatureArtifactId: signatureArtifactId, receiverConfirmedAt: confirmedAt })
  }, [signatureArtifactId, confirmedAt, draft.podSignatureArtifactId, onUpdate])

  // The draft is the source of truth for "has this happened", not the hook: a driver who
  // backgrounds the app and returns gets a freshly mounted hook with no confirmation yet,
  // and must not be sent back to a QR for a delivery that is already confirmed.
  const isConfirmed = draft.podSignatureArtifactId !== null

  if (isConfirmed) {
    return (
      <main className="flex min-h-dvh flex-col">
        <StepHeader phase={phase} stepIndex={stepIndex} />
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-primary-container">
            <span className="text-3xl" aria-hidden="true">✓</span>
          </div>
          <p className="text-xl font-medium text-surface-on">Receiver confirmed the delivery</p>
          {draft.receiverConfirmedAt !== null && (
            <p className="text-base text-surface-on-variant">
              Signed at {formatTime(draft.receiverConfirmedAt)}
            </p>
          )}
          <p className="max-w-sm text-sm text-surface-on-variant">
            Their signature was recorded on their own device, with their own location.
          </p>
        </div>
        <div className="flex justify-center px-6 pt-6 pb-safe">
          <SwipeToConfirm label="Continue" onConfirm={onComplete} />
        </div>
      </main>
    )
  }

  return (
    <main className="flex min-h-dvh flex-col">
      <StepHeader phase={phase} stepIndex={stepIndex} />
      <div className="flex flex-1 flex-col items-center gap-6 p-4">
        <p className="text-lg leading-relaxed text-surface-on-variant">
          Ask the receiver to scan this code with their phone camera. They sign on their
          own device.
        </p>

        {/* White plate, always — the QR must not inherit a dark theme (QrCode.tsx). */}
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <QrCode value={scanUrl} />
        </div>

        <div className="flex flex-col items-center gap-1 text-center">
          {receiverOpened ? (
            <>
              <p className="text-base font-medium text-surface-on">
                The receiver has opened the link
              </p>
              <p className="text-sm text-surface-on-variant">
                The code has stopped changing while they sign. Waiting for them to finish.
              </p>
            </>
          ) : (
            <>
              <p className="text-base font-medium text-surface-on">Waiting for the receiver…</p>
              <p className="text-sm text-surface-on-variant">
                The code refreshes on its own. An old photo of it will not work.
              </p>
            </>
          )}
        </div>

        {error !== null && (
          <div className="flex w-full flex-col items-center gap-3 rounded-xl border border-error/40 bg-error-container/30 p-4">
            <p className="text-center text-sm text-surface-on">{error}</p>
            <Button variant="secondary" onClick={forceNewCode} disabled={isIssuing}>
              {isIssuing ? 'Refreshing…' : 'Try again'}
            </Button>
          </div>
        )}

        {/* The stranding escape hatch. A receiver who opens the link and then loses the
            browser session holding their binding cookie can neither confirm nor be given
            a new code, because the rotation has paused for them. The driver is standing
            right there, so let them retire it and start again. Shown only once the link
            has actually been opened — before that, the rotation is already doing this. */}
        {receiverOpened && error === null && (
          <button
            type="button"
            onClick={forceNewCode}
            disabled={isIssuing}
            className="text-sm underline text-surface-on-variant disabled:opacity-50"
          >
            Receiver having trouble? Show a new code
          </button>
        )}
      </div>
    </main>
  )
}
