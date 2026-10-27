// Shows a rotating QR; the receiver signs on their own phone, reached by scanning it.
// The property that matters is not who the receiver is (we still cannot prove that) but
// that the confirmation was produced somewhere the driver's device is not.
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

  useEffect(() => {
    if (signatureArtifactId === null) return
    if (draft.podSignatureArtifactId === signatureArtifactId) return
    onUpdate({ podSignatureArtifactId: signatureArtifactId, receiverConfirmedAt: confirmedAt })
  }, [signatureArtifactId, confirmedAt, draft.podSignatureArtifactId, onUpdate])

  const isConfirmed = draft.podSignatureArtifactId !== null

  if (isConfirmed) {
    return (
      <StepLayout
        phase={phase}
        stepIndex={stepIndex}
        showTitle={false}
        action={<SwipeToConfirm label="Swipe to Continue" onConfirm={onComplete} />}
      >
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

  return (
    <StepLayout
      phase={phase}
      stepIndex={stepIndex}
      intro="Ask them to scan this with their phone camera. They sign on their own device."
    >
      <div className="flex w-full flex-col items-center gap-6 overflow-x-hidden">
        <div className="w-full max-w-[296px] rounded-[28px] bg-white p-[18px] shadow-ambient ring-1 ring-hairline">
          <QrCode value={scanUrl} />
        </div>

        <div role="status" className="flex max-w-sm flex-col items-center gap-1.5 text-center">
          <p className="inline-flex items-center gap-2 text-headline text-surface-on">
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

        {receiverOpened && error === null && (
          <Button variant="fill" size="pill-sm" onClick={forceNewCode} disabled={isIssuing}>
            Receiver Having Trouble? Show a New Code
          </Button>
        )}
      </div>
    </StepLayout>
  )
}
