// frontend/driver-pwa/components/phase/steps/confirmation/ReceiverHandover.tsx
//
// Replaces PodSignature.tsx (FP-155). The driver no longer collects the signature.
//
// A 2026-06-29 decision settled that proof of delivery is a photo AND a signature, both
// required. That still holds — the artifact is still produced, still uploaded, still
// required at submit. What changed is WHERE it is produced: on the receiver's own phone,
// reached by scanning the rotating QR this step displays. The property that matters is not
// who the receiver is (we still cannot prove that) but that the confirmation was produced
// somewhere the driver's device is not.
//
// This step captures nothing locally and holds no evidence of its own. Its entire job is
// to display a code, wait, and write the resulting artifact id into the draft that
// ConfirmationCompleteRequest.pod_signature_artifact_id is built from.
'use client'

import { useEffect } from 'react'
import { Check } from 'lucide-react'
import { StepLayout } from '@/components/phase/StepLayout'
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
      <StepLayout
        phase={phase}
        stepIndex={stepIndex}
        showTitle={false}
        action={<SwipeToConfirm label="Swipe to Continue" onConfirm={onComplete} />}
      >
        {/* No signature image (D7, Tim 14 Oct): the signature is the receiver's evidence,
            held server-side. The driver's screen says only that it happened, and when. */}
        <div className="flex flex-col items-center pt-10 text-center">
          <span className="flex size-28 items-center justify-center rounded-full bg-success-tint">
            <span className="flex size-20 items-center justify-center rounded-full bg-success text-success-on">
              <Check className="size-10" strokeWidth={2.6} aria-hidden />
            </span>
          </span>
          <h1 className="mt-6 text-title-1 tracking-tight text-surface-on">Receiver signed</h1>
          <p className="mt-2 text-body text-surface-on-variant">
            {draft.receiverConfirmedAt !== null && (
              <>Signed at <span className="font-semibold tabular-nums text-surface-on">{formatTime(draft.receiverConfirmedAt)}</span> </>
            )}
            on their own device, with their own location.
          </p>
        </div>
      </StepLayout>
    )
  }

  // No action while waiting: the receiver's own device completes this step, not a swipe.
  return (
    <StepLayout
      phase={phase}
      stepIndex={stepIndex}
      intro="Ask them to scan this with their phone camera. They sign on their own device."
    >
      <div className="flex w-full flex-col items-center gap-6 overflow-x-hidden">
        {/* White plate, always — the QR must not inherit a dark theme (QrCode.tsx). An
            explicit width (the QR's 260px ceiling + 2 × 18px padding), not shrink-to-fit:
            QrCode is w-full, so in a content-sized plate its placeholder — shown while the
            code is issued, or when issuing fails — collapsed to nothing. */}
        <div className="w-full max-w-[296px] rounded-[28px] bg-white p-[18px] shadow-ambient ring-1 ring-hairline">
          <QrCode value={scanUrl} />
        </div>

        <div role="status" className="flex max-w-sm flex-col items-center gap-1.5 text-center">
          <p className="inline-flex items-center gap-2 text-headline text-surface-on">
            {/* Blue: progress, the one thing blue means in this app. */}
            <span aria-hidden className="size-2 rounded-full bg-secondary ring-4 ring-secondary/20" />
            {receiverOpened ? 'The receiver has opened the link' : 'Waiting for the receiver'}
          </p>
          <p className="text-subhead text-surface-on-variant">
            {receiverOpened
              ? 'The code has stopped changing while they sign. Waiting for them to finish.'
              : 'The code refreshes itself, so a photo of an old one won’t work.'}
          </p>
        </div>

        {error !== null && (
          <div className="flex w-full flex-col items-center gap-3 rounded-2xl bg-error-tint p-4">
            <p className="text-center text-subhead text-surface-on">{error}</p>
            <Button variant="fill" size="pill-sm" onClick={forceNewCode} disabled={isIssuing}>
              {isIssuing ? 'Refreshing…' : 'Try Again'}
            </Button>
          </div>
        )}

        {/* The stranding escape hatch. A receiver who opens the link and then loses the
            browser session holding their binding cookie can neither confirm nor be given
            a new code, because the rotation has paused for them. The driver is standing
            right there, so let them retire it and start again. Shown only once the link
            has actually been opened — before that, the rotation is already doing this. */}
        {receiverOpened && error === null && (
          <Button variant="fill" size="pill-sm" onClick={forceNewCode} disabled={isIssuing}>
            Receiver Having Trouble? Show a New Code
          </Button>
        )}
      </div>
    </StepLayout>
  )
}
