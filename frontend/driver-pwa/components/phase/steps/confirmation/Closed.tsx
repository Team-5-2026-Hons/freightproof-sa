'use client'

import { CheckCircle2 } from 'lucide-react'
import { StepLayout } from '@/components/phase/StepLayout'
import { SwipeToConfirm } from '@/components/phase/SwipeToConfirm'
import { WarehouseWaitCard } from '@/components/phase/WarehouseWaitCard'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { ConfirmationEvidence } from '@/lib/types/evidence-draft'

interface ClosedProps {
  tripId: string
  phase: PhaseDescriptor
  stepIndex: number
  draft: ConfirmationEvidence
  onComplete: () => void | Promise<void>
}

export function Closed({ tripId, phase, stepIndex, draft, onComplete }: ClosedProps) {
  // Only THIS phase's draft: unloading fields (waybillHandedOver etc.) belong to a
  // separate phase_event_id and are already resolved server-side by this point.
  // driverVisualCount is deliberately excluded — it's optional, and gating on it made a
  // skipped count silently unclosable. The signature half is the receiver's confirmation
  // (FP-155), so this checks the artifact id the handover poll wrote into the draft.
  const isReady =
    draft.podPhotoDataUrl !== null &&
    Boolean(draft.podSignatureArtifactId)

  // Gated on the destination warehouse's scan-IN session (GATED_PHASES, phase_gate.py).
  // Coalesced to null first: `blocked_on` is optional on the shared type, so a bare
  // `!== null` reads `undefined !== null` and is permanently true.
  const isBlocked = (phase.blocked_on ?? null) !== null

  // Navigation stays with the caller: onComplete() submits, clears the draft, and
  // advances. Its promise is returned so SwipeToConfirm holds the "Submitting…" lock.
  function handleClose(): void | Promise<void> {
    return onComplete()
  }

  // No success tick and no swipe while blocked: the control is omitted entirely rather
  // than left visible-but-disabled, and the wait card says why.
  if (isBlocked) {
    return (
      <StepLayout phase={phase} stepIndex={stepIndex} centered>
        <WarehouseWaitCard>
          The warehouse is still scanning the parcels in at this stop. The trip will
          close on its own once they finish. Your evidence is saved — no action is
          needed from you.
        </WarehouseWaitCard>
      </StepLayout>
    )
  }

  return (
    <StepLayout
      phase={phase}
      stepIndex={stepIndex}
      centered
      requirements={[
        { label: 'Proof of delivery photo', met: draft.podPhotoDataUrl !== null },
        { label: 'Receiver confirmation', met: Boolean(draft.podSignatureArtifactId) },
      ]}
      action={<SwipeToConfirm label="Close Trip" onConfirm={handleClose} disabled={!isReady} />}
    >
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-success/10">
        <CheckCircle2 className="h-10 w-10 text-success" strokeWidth={2} aria-hidden />
      </div>
      <div>
        <p className="text-title-2">Trip Complete</p>
        <p className="mt-1 text-body text-surface-on-variant">
          All phases are complete. Evidence has been recorded.
        </p>
      </div>
    </StepLayout>
  )
}
